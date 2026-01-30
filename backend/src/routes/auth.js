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
router.post('/signup',

  body('email').isEmail().normalizeEmail(),
  body('surname').isString().trim().escape(),
  body('firstName').isString().trim().escape(),
  body('middleName').optional().isString().trim().escape(),
  body('matricNumber').isString().trim(),
  body('password').isString().isLength({ min: 6 }),

  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const email = String(req.body.email || '').trim().toLowerCase();
    const surname = String(req.body.surname || '').trim();
    const firstName = String(req.body.firstName || '').trim();
    const middleName = String(req.body.middleName || '').trim();
    const matricNumber = String(req.body.matricNumber || '').trim().toUpperCase();
    const password = req.body.password;

    if (!validateEmailDomain(email)) {
      return res.status(400).json({ error: 'Email must use institutional domain' });
    }

    try {
      const hashed = await bcrypt.hash(password, 10);
      const { rows } = await query(
        `INSERT INTO users (role, email, surname, first_name, middle_name, matric_number, hashed_password)
         VALUES ('student', $1, $2, $3, $4, $5, $6)
         RETURNING id, role, email, matric_number, staff_id`,
        [email, surname, firstName, middleName || null, matricNumber, hashed]
      );
      const user = rows[0];
      const userIdUInt8Array = new TextEncoder().encode(user.id.toString());

      const regOptions = await generateRegistrationOptions({
        rpName: rpName,
        rpID: rpID,
        userID: userIdUInt8Array,
        userName: user.email,
      });

      await query('UPDATE users SET webauthn_current_challenge = $1 WHERE id = $2', [regOptions.challenge, user.id]);

      const loginTicket = createLoginTicket(user.id, 'register');
      return res.json({ registerRequired: true, loginTicket, options: regOptions });
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ error: 'Account already exists for this email or matric number' });
      }
      console.log(e);
      return res.status(500).json({ error: 'Failed to create account' });
    }
  }
);

// Teacher signup (public) — creates teacher account with password
router.post(
  '/teacher-signup',
  body('email').isEmail().normalizeEmail(),
  body('surname').isString().trim().escape(),
  body('firstName').isString().trim().escape(),
  body('middleName').optional().isString().trim().escape(),
  body('title').isString().trim().escape(),
  body('sex').isString().trim().escape(),
  body('staffId').isString().trim().escape(),
  body('password').isString().isLength({ min: 6 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const email = String(req.body.email || '').trim().toLowerCase();
    const staffId = String(req.body.staffId || '').trim().toUpperCase();
    const password = req.body.password;
    const surname = String(req.body.surname || '').trim();
    const firstName = String(req.body.firstName || '').trim();
    const middleName = String(req.body.middleName || '').trim();
    const title = String(req.body.title || '').trim().toLowerCase();
    const sex = String(req.body.sex || '').trim().toLowerCase();

    if (!validateEmailDomain(email)) {
      return res.status(400).json({ error: 'Email must use institutional domain' });
    }

    try {
      const hashed = await bcrypt.hash(password, 10);
      const { rows } = await query(
        `INSERT INTO users (role, email, staff_id, surname, first_name, middle_name, title, sex, hashed_password)
         VALUES ('teacher', $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, role, email, staff_id`,
        [email, staffId, surname, firstName, middleName || null, title, sex, hashed]
      );
      return issueLoginSuccess(rows[0], res);
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ error: 'Account already exists for this email or staff ID' });
      }
      console.log(e);
      return res.status(500).json({ error: 'Failed to create teacher account' });
    }
  }
);

const loginStartValidators = [
  body('identifier').isString().trim(),
  body('password').isString().isLength({ min: 6 }),
  body('deviceId').optional().isString().trim(),
];

// Login start: password check, then WebAuthn for students
async function loginStartHandler(req, res) {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
  const identifierRaw = String(req.body.identifier || '').trim();
  const deviceId = String(req.body.deviceId || '').trim();
  const password = req.body.password;

  try {
    if (deviceId) {
      const { rows: cooldownRows } = await query(
        'SELECT cooldown_until FROM device_cooldowns WHERE device_id = $1',
        [deviceId]
      );
      const cooldownUntil = cooldownRows[0]?.cooldown_until;
      if (cooldownUntil && new Date(cooldownUntil).getTime() > Date.now()) {
        return res.status(429).json({ error: 'This device is on a short cooldown. Try again shortly.' });
      }
    }
    const { rows } = await query(
      `SELECT id, role, email, matric_number, staff_id, hashed_password
       FROM users
       WHERE LOWER(email) = LOWER($1)
          OR UPPER(matric_number) = UPPER($1)
          OR UPPER(staff_id) = UPPER($1)
       LIMIT 1`,
      [identifierRaw]
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

    const creds = await query('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id =$1', [user.id]);
    if (!creds) return res.status(400).json({ error: 'Wrong device' });

    const authOptions = await generateAuthenticationOptions({
      rpID: rpID,
      allowCredentials: [
        {
          id: creds.rows[0].credential_id,
          transports: creds.rows[0].transports
        }
      ]
    });

    if (!authOptions) {
      console.log('something failed');
      return res.status(403).json({ error: 'No registered device found. Please contact an administrator.' });
    }

    await query('UPDATE users SET webauthn_current_challenge = $1 WHERE id = $2', [authOptions.challenge, user.id]);

    const loginTicket = createLoginTicket(user.id, 'authenticate');
    return res.json({ webauthnRequired: true, loginTicket, options: authOptions });
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
      
      const verification = await verifyRegistrationResponse({
        response: req.body.credential,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID
      });

      if (!verification.verified || !verification.registrationInfo) {
        return res.status(400).json({ error: 'Registration verification failed' });
      }

      const publicKeyBuffer = Buffer.from(verification.registrationInfo.credential.publicKey).toString('base64');

      await query(
        `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (credential_id)
         DO UPDATE SET public_key = EXCLUDED.public_key, 
                       counter = EXCLUDED.counter, 
                       transports = EXCLUDED.transports, 
                       user_id = EXCLUDED.user_id`,
        [
          user.id,
          verification.registrationInfo.credential.id,
          publicKeyBuffer, 
          verification.registrationInfo.credential.counter, 
          verification.registrationInfo.credential.transports ?? null
        ]
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
      console.log('space');

      const user = await verifyLoginTicket(req.body.loginTicket, 'authenticate');
      const credential = req.body.credential;

      const { rows } = await query('SELECT users.webauthn_current_challenge FROM webauthn_credentials JOIN users ON users.id = webauthn_credentials.user_id WHERE webauthn_credentials.credential_id = $1', [credential.id]);
      const current_challenge = rows[0]?.webauthn_current_challenge;
      if (!current_challenge) return res.status(400).json({ error: 'Wrong device' });

      const retrieved = await query('SELECT * FROM webauthn_credentials WHERE credential_id = $1', [credential.id]);
      const stored_credentials = retrieved.rows[0];

      const verification = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: current_challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: stored_credentials.credential_id,
          publicKey: Buffer.from(stored_credentials.public_key, 'base64'),
          counter: stored_credentials.counter,
          transports: stored_credentials.transports
        }
      });

      if (!verification.verified) {
        return res.status(400).json({ error: 'Authentication failed' });
      }

      await query('UPDATE webauthn_credentials SET counter = $1 WHERE id = $2', [
        verification.authenticationInfo.newCounter,
        stored_credentials.id,
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
