import express from 'express';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { origin, rpID, rpName, toBase64Url, fromBase64Url } from '../utils/webauthn.js';

const router = express.Router();

function requireBase64UrlString(value, name) {
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value;
}

function b64urlToBuffer(value) {
  return Buffer.from(value, 'base64url');
}

// Check if the current user already has credentials
router.get('/webauthn/status', requireAuth(['student']), async (req, res) => {
  const { rows } = await query('SELECT COUNT(*)::int AS total FROM webauthn_credentials WHERE user_id = $1', [req.user.id]);
  res.json({ registered: rows[0]?.total > 0 });
});

// Start registration (student must be authenticated)
router.post('/webauthn/register/start', requireAuth(['student']), async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT email FROM users WHERE id = $1', [req.user.id]);
    const userEmail = userRows[0]?.email || `student-${req.user.id}`;
    const { rows: creds } = await query('SELECT credential_id FROM webauthn_credentials WHERE user_id = $1', [req.user.id]);
    const filtered = creds.filter((c) => typeof c.credential_id === 'string' && c.credential_id.length > 0);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(String(req.user.id)),
      userName: userEmail,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: filtered.map((c) => ({
        id: fromBase64Url(c.credential_id),
        type: 'public-key',
      })),
    });
    await query('UPDATE users SET webauthn_current_challenge = $1 WHERE id = $2', [options.challenge, req.user.id]);
    res.json(options);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unable to start WebAuthn registration' });
  }
});

// Finish registration
router.post('/webauthn/register/finish', requireAuth(['student']), async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT webauthn_current_challenge FROM users WHERE id = $1',
      [req.user.id]
    );
    const challenge = rows[0]?.webauthn_current_challenge;
    if (!challenge) return res.status(400).json({ error: 'No registration challenge pending' });

    const cred = req.body || {};
    const id = requireBase64UrlString(cred.id, 'credential id');
    const rawIdB64 = requireBase64UrlString(cred.rawId, 'credential rawId');

    const attObj = b64urlToBuffer(cred.response?.attestationObject);
    const clientData = b64urlToBuffer(cred.response?.clientDataJSON);
    if (!attObj || !clientData) {
      return res.status(400).json({ error: 'Malformed WebAuthn attestation payload' });
    }

    const verification = await verifyRegistrationResponse({
      response: {
        id,
        rawId: b64urlToBuffer(rawIdB64),
        response: {
          attestationObject: attObj,
          clientDataJSON: clientData,
          transports: cred.response?.transports,
        },
        type: cred.type || 'public-key',
        clientExtensionResults: cred.clientExtensionResults || {},
      },
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Registration verification failed' });
    }

    const { registrationInfo } = verification;
    const credentialIdToStore = toBase64Url(registrationInfo.credentialID);
    const publicKey = toBase64Url(registrationInfo.credentialPublicKey);
    const counter = registrationInfo.counter || 0;

    await query(
      `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (credential_id)
       DO UPDATE SET public_key = EXCLUDED.public_key, counter = EXCLUDED.counter, 
                     transports = EXCLUDED.transports, user_id = EXCLUDED.user_id`,
      [req.user.id, credentialIdToStore, publicKey, counter, cred.response?.transports || null]
    );
    await query('UPDATE users SET webauthn_current_challenge = NULL WHERE id = $1', [req.user.id]);
    res.json({ verified: true });
  } catch (e) {
    console.error('WebAuthn register finish error:', e);
    res.status(400).json({ error: e.message || 'Failed to complete registration' });
  }
});

// Start authentication
router.post('/webauthn/authenticate/start', requireAuth(['student']), async (req, res) => {
  try {
    const { rows: creds } = await query(
      'SELECT credential_id FROM webauthn_credentials WHERE user_id = $1',
      [req.user.id]
    );
    const filtered = creds.filter((c) => typeof c.credential_id === 'string' && c.credential_id.length > 0);
    if (!filtered.length) return res.status(400).json({ error: 'No registered device found' });
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: filtered.map((c) => ({
        id: c.credential_id, // base64url string expected
        type: 'public-key',
      })),
      userVerification: 'preferred',
    });
    await query('UPDATE users SET webauthn_current_challenge = $1 WHERE id = $2', [options.challenge, req.user.id]);
    res.json(options);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unable to start authentication' });
  }
});

// Finish authentication
router.post('/webauthn/authenticate/finish', requireAuth(['student']), async (req, res) => {
  try {
    const { rows: userRows } = await query(
      'SELECT webauthn_current_challenge FROM users WHERE id = $1',
      [req.user.id]
    );
    const challenge = userRows[0]?.webauthn_current_challenge;
    if (!challenge) return res.status(400).json({ error: 'No authentication challenge pending' });

    const credentialId = requireBase64UrlString(req.body?.id, 'credential id');
    const rawId = req.body?.rawId ? requireBase64UrlString(req.body.rawId, 'credential rawId') : credentialId;

    const { rows: credRows } = await query(
      'SELECT * FROM webauthn_credentials WHERE user_id = $1 AND credential_id = $2',
      [req.user.id, credentialId]
    );
    const authenticator = credRows[0];
    if (!authenticator) return res.status(400).json({ error: 'Credential not found' });

    const authData = b64urlToBuffer(req.body?.response?.authenticatorData);
    const clientDataJSON = b64urlToBuffer(req.body?.response?.clientDataJSON);
    const signature = b64urlToBuffer(req.body?.response?.signature);
    const userHandle = req.body?.response?.userHandle ? b64urlToBuffer(req.body.response.userHandle) : undefined;
    if (!authData || !clientDataJSON || !signature) {
      return res.status(400).json({ error: 'Malformed WebAuthn assertion payload' });
    }

    const verification = await verifyAuthenticationResponse({
      response: {
        id: credentialId,
        rawId: isoBase64URL.toBuffer(rawId),
        type: req.body?.type || 'public-key',
        response: {
          authenticatorData: authData,
          clientDataJSON,
          signature,
          userHandle,
        },
        clientExtensionResults: req.body?.clientExtensionResults || {},
      },
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: fromBase64Url(authenticator.credential_id),
        credentialPublicKey: fromBase64Url(authenticator.public_key),
        counter: Number(authenticator.counter) || 0,
      },
    });

    if (!verification.verified) return res.status(400).json({ error: 'Authentication failed' });

    const newCounter = verification.authenticationInfo.newCounter;
    await query('UPDATE webauthn_credentials SET counter = $1 WHERE id = $2', [newCounter, authenticator.id]);
    await query(
      'UPDATE users SET webauthn_current_challenge = NULL, webauthn_verified_at = NOW(), webauthn_verified_credential = $1 WHERE id = $2',
      [authenticator.credential_id, req.user.id]
    );
    res.json({ verified: true });
  } catch (e) {
    console.error('WebAuthn authenticate finish error:', e);
    res.status(400).json({ error: e.message || 'Failed to complete authentication' });
  }
});

export default router;
