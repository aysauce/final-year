import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { query } from '../db.js';
import { signJwt } from '../middleware/auth.js';
import { origin, rpID, rpName, toBase64Url, fromBase64Url } from '../utils/webauthn.js';

const router = express.Router();
const LOGIN_TICKET_EXPIRY = '5m';

// Helpers
function createLoginTicket(userId, stage) {
  return jwt.sign({ sub: userId, stage }, process.env.JWT_SECRET, { expiresIn: LOGIN_TICKET_EXPIRY });
}

function requireBase64UrlString(value, name) {
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing or invalid ${name}`);
  }
  return value;
}

function b64urlToBuffer(value) {
  try {
    return Buffer.from(value, 'base64url');
  } catch (_) {
    // fallback if client sent plain base64
    try {
      return Buffer.from(value, 'base64');
    } catch (err) {
      throw new Error(`Invalid ${value} encoding`);
    }
  }
}

async function verifyLoginTicket(token, expectedStage) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.stage !== expectedStage) throw new Error('Invalid stage');
    const { rows } = await query(
      `SELECT id, role, email, matric_number, staff_id, hashed_password
       FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (!rows[0]) throw new Error('User not found');
    return rows[0];
  } catch (e) {
    throw new Error('Invalid or expired login ticket');
  }
}

async function buildRegistrationOptions(userId, email) {
  const { rows: creds } = await query('SELECT credential_id FROM webauthn_credentials WHERE user_id = $1', [userId]);
  const filtered = creds.filter((c) => typeof c.credential_id === 'string' && c.credential_id.length > 0);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: Buffer.from(String(userId)),
    userName: email,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    excludeCredentials: filtered.map((c) => ({
      id: fromBase64Url(c.credential_id),
      type: 'public-key',
    })),
  });
  await query('UPDATE users SET webauthn_current_challenge = $1 WHERE id = $2', [options.challenge, userId]);
  return options;
}

async function buildAuthenticationOptions(userId) {
  // Clean any blank/invalid credentials first
  await query(
    "DELETE FROM webauthn_credentials WHERE user_id = $1 AND (credential_id IS NULL OR credential_id = '' OR public_key IS NULL OR public_key = '')",
    [userId]
  );
  const { rows: creds } = await query('SELECT credential_id FROM webauthn_credentials WHERE user_id = $1', [userId]);
  const filtered = creds.filter((c) => typeof c.credential_id === 'string' && c.credential_id.length > 0);
  if (!filtered.length) return null;
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: filtered.map((c) => ({
      id: c.credential_id, // base64url string expected by library
      type: 'public-key',
    })),
    userVerification: 'preferred',
  });
  await query('UPDATE users SET webauthn_current_challenge = $1 WHERE id = $2', [options.challenge, userId]);
  return options;
}

async function issueLoginSuccess(user, res) {
  const token = signJwt(user);
  res.json({
    loginComplete: true,
    token,
    role: user.role,
    userId: user.id,
    email: user.email,
    matric: user.matric_number,
    staffId: user.staff_id,
  });
}

const domainList = (process.env.INSTITUTION_EMAIL_DOMAIN || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function validateEmailDomain(email) {
  if (!domainList.length) return true;
  return domainList.some((domain) => email.toLowerCase().endsWith(domain));
}

// Signup (student) — creates user and returns WebAuthn registration options + login ticket
router.post(
  '/signup',
  body('email').isEmail().normalizeEmail(),
  body('matricNumber').isString().trim().escape(),
  body('password').isString().isLength({ min: 6 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { email, matricNumber, password } = req.body;
    if (!validateEmailDomain(email)) {
      return res.status(400).json({ error: 'Email must use institutional domain' });
    }
    try {
      const hashed = await bcrypt.hash(password, 10);
      const { rows } = await query(
        `INSERT INTO users (role, email, matric_number, hashed_password)
         VALUES ('student', $1, $2, $3)
         RETURNING id, role, email, matric_number, staff_id`,
        [email, matricNumber, hashed]
      );
      const user = rows[0];
      const options = await buildRegistrationOptions(user.id, user.email);
      const loginTicket = createLoginTicket(user.id, 'register');
      return res.json({ registerRequired: true, loginTicket, options });
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ error: 'Account already exists for this email or matric number' });
      }
      console.log(e);
      return res.status(500).json({ error: 'Failed to create account' });
    }
  }
);

const loginStartValidators = [
  body('identifier').isString().trim().escape(),
  body('password').isString().isLength({ min: 6 }),
];

// Login start: password check, then WebAuthn for students
async function loginStartHandler(req, res) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
  const { identifier, password } = req.body;

  try {
    const { rows } = await query(
      `SELECT id, role, email, matric_number, staff_id, hashed_password
       FROM users
       WHERE email = $1 OR matric_number = $1 OR staff_id = $1
       LIMIT 1`,
      [identifier]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const hashed = user.hashed_password || '';
    let ok = false;
    if (hashed.startsWith('$2')) {
      ok = await bcrypt.compare(password, hashed);
    } else {
      const chk = await query('SELECT crypt($1, $2) = $2 AS ok', [password, hashed]);
      ok = !!chk.rows?.[0]?.ok;
    }
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.role !== 'student') {
      return issueLoginSuccess(user, res);
    }

    const authOptions = await buildAuthenticationOptions(user.id);
    if (authOptions) {
      const loginTicket = createLoginTicket(user.id, 'authenticate');
      return res.json({ webauthnRequired: true, loginTicket, options: authOptions });
    }
    return res.status(403).json({ error: 'No registered device found. Please contact an administrator.' });
  } catch (e) {
    console.log(e);
    res.status(500).json({ error: 'Login failed' });
  }
}

router.post('/login/start', loginStartValidators, loginStartHandler);
router.post('/login', loginStartValidators, loginStartHandler);

// Finish WebAuthn registration
router.post(
  '/login/register-finish',
  body('loginTicket').isString(),
  body('credential').notEmpty(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    try {
      const user = await verifyLoginTicket(req.body.loginTicket, 'register');
      const { rows } = await query('SELECT webauthn_current_challenge FROM users WHERE id = $1', [user.id]);
      const challenge = rows[0]?.webauthn_current_challenge;
      if (!challenge) return res.status(400).json({ error: 'No registration challenge pending' });

      const cred = req.body.credential;

      const rawIdString = requireBase64UrlString(cred.rawId, 'credential rawId');
      const idString = requireBase64UrlString(cred.id || rawIdString, 'credential id');

      const verification = await verifyRegistrationResponse({
        response: cred,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: 'Registration verification failed' });
      }

      const { registrationInfo } = verification;
      // Support both older and newer simplewebauthn shapes
      const regCredId =
        registrationInfo.credentialID ||
        registrationInfo.credential?.id ||
        b64urlToBuffer(rawIdString);
      const regPubKey =
        registrationInfo.credentialPublicKey ||
        registrationInfo.credential?.publicKey ||
        null;

      const credentialIdToStore = toBase64Url(regCredId);
      const publicKey = regPubKey ? toBase64Url(regPubKey) : '';
      const counter = registrationInfo.counter || registrationInfo.credential?.counter || 0;

      if (!credentialIdToStore || !publicKey) {
        return res.status(400).json({ error: 'Invalid credential data returned by authenticator' });
      }

      await query(
        `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (credential_id)
         DO UPDATE SET public_key = EXCLUDED.public_key, counter = EXCLUDED.counter, 
                       transports = EXCLUDED.transports, user_id = EXCLUDED.user_id`,
        [user.id, credentialIdToStore, publicKey, counter, cred.response?.transports || null]
      );
      await query('UPDATE users SET webauthn_current_challenge = NULL WHERE id = $1', [user.id]);

      return issueLoginSuccess(user, res);
    } catch (e) {
      console.error('Registration finish error:', e);
      res.status(400).json({ error: e.message || 'Registration finish failed' });
    }
  }
);

// Finish WebAuthn authentication
router.post(
  '/login/finish',
  body('loginTicket').isString(),
  body('credential').notEmpty(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    try {
      const user = await verifyLoginTicket(req.body.loginTicket, 'authenticate');
      const { rows } = await query('SELECT webauthn_current_challenge FROM users WHERE id = $1', [user.id]);
      const challenge = rows[0]?.webauthn_current_challenge;
      if (!challenge) return res.status(400).json({ error: 'No authentication challenge pending' });

      const cred = req.body.credential;
      if (!cred?.id || !cred?.rawId) return res.status(400).json({ error: 'Missing credential id' });

      const { rows: credRows } = await query(
        'SELECT * FROM webauthn_credentials WHERE user_id = $1 AND credential_id = $2',
        [user.id, cred.id]
      );
      const authenticator = credRows[0];
      if (!authenticator) return res.status(400).json({ error: 'Credential not found' });

      const storedCredId = authenticator.credential_id || '';
      const storedPubKey = authenticator.public_key || '';
      const storedCounter = Number(authenticator.counter) || 0;
      const authCredIdBuf = fromBase64Url(storedCredId);
      const authPubKeyBuf = fromBase64Url(storedPubKey);
      if (!authCredIdBuf?.length || !authPubKeyBuf?.length) {
        return res.status(400).json({ error: 'Stored credential is invalid; please re-register your device' });
      }

      const authenticatorData = cred.response?.authenticatorData;
      const clientDataJSON = cred.response?.clientDataJSON;
      const signature = cred.response?.signature;
      const userHandle = cred.response?.userHandle;
      if (!authenticatorData || !clientDataJSON || !signature) {
        return res.status(400).json({ error: 'Malformed WebAuthn assertion payload' });
      }

      const verification = await verifyAuthenticationResponse({
        response: {
          id: cred.id,
          rawId: cred.rawId,
          type: cred.type || 'public-key',
          response: {
            authenticatorData,
            clientDataJSON,
            signature,
            userHandle,
          },
          clientExtensionResults: cred.clientExtensionResults || {},
        },
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        authenticator: {
          credentialID: authCredIdBuf,
          credentialPublicKey: authPubKeyBuf,
          counter: storedCounter,
          transports: authenticator.transports || undefined,
        },
      });

      if (!verification.verified) {
        return res.status(400).json({ error: 'Authentication failed' });
      }

      await query('UPDATE webauthn_credentials SET counter = $1 WHERE id = $2', [
        verification.authenticationInfo.newCounter,
        authenticator.id,
      ]);
      await query('UPDATE users SET webauthn_current_challenge = NULL WHERE id = $1', [user.id]);

      return issueLoginSuccess(user, res);
    } catch (e) {
      console.error('Login finish error:', e);
      res.status(400).json({ error: e.message || 'Login finish failed' });
    }
  }
);

export default router;
