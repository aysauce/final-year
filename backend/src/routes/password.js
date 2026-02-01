import express from 'express';
import bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { body, validationResult } from 'express-validator';
import { query } from '../db.js';
import { sendPasswordResetEmail } from '../utils/email.js';

const router = express.Router();

const RESET_TTL_MINUTES = Number.parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '15', 10);

const domainList = (process.env.INSTITUTION_EMAIL_DOMAIN || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function validateEmailDomain(email) {
  if (!domainList.length) return true;
  return domainList.some((domain) => email.toLowerCase().endsWith(domain));
}

router.post(
  '/password/forgot',
  body('email').isEmail().normalizeEmail(),
  body('role').isIn(['student', 'teacher']),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const email = String(req.body.email || '').trim().toLowerCase();
    const role = String(req.body.role || '').trim().toLowerCase();

    if (!validateEmailDomain(email)) {
      return res.status(400).json({ error: 'Email must use institutional domain' });
    }

    try {
      const { rows } = await query(
        'SELECT id, email, surname, first_name FROM users WHERE LOWER(email) = LOWER($1) AND role = $2 LIMIT 1',
        [email, role]
      );
      const user = rows[0];
      if (!user) {
        return res.json({ ok: true });
      }

      const code = String(randomInt(0, 1000000)).padStart(6, '0');
      const codeHash = await bcrypt.hash(code, 10);
      const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

      await query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
      await query(
        'INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, codeHash, expiresAt]
      );

      await sendPasswordResetEmail(user.email, code, {
        minutes: RESET_TTL_MINUTES,
        surname: user.surname,
        firstName: user.first_name,
      });

      return res.json({ ok: true });
    } catch (e) {
      console.error('Forgot password error:', e);
      return res.status(500).json({ error: 'Failed to send reset code' });
    }
  }
);

router.post(
  '/password/reset',
  body('email').isEmail().normalizeEmail(),
  body('role').isIn(['student', 'teacher']),
  body('code').isString().trim().isLength({ min: 4 }),
  body('newPassword').isString().isLength({ min: 6 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const email = String(req.body.email || '').trim().toLowerCase();
    const role = String(req.body.role || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const newPassword = req.body.newPassword;

    try {
      const { rows } = await query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND role = $2 LIMIT 1',
        [email, role]
      );
      const user = rows[0];
      if (!user) {
        return res.status(400).json({ error: 'Invalid reset code' });
      }

      const { rows: resetRows } = await query(
        `SELECT id, code_hash, expires_at, used_at
         FROM password_resets
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [user.id]
      );
      const reset = resetRows[0];
      if (!reset || reset.used_at) {
        return res.status(400).json({ error: 'Invalid reset code' });
      }

      if (new Date(reset.expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: 'Reset code expired' });
      }

      const ok = await bcrypt.compare(code, reset.code_hash);
      if (!ok) {
        return res.status(400).json({ error: 'Invalid reset code' });
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      await query('UPDATE users SET hashed_password = $1 WHERE id = $2', [hashed, user.id]);
      await query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [reset.id]);

      return res.json({ ok: true });
    } catch (e) {
      console.error('Reset password error:', e);
      return res.status(500).json({ error: 'Failed to reset password' });
    }
  }
);

export default router;
