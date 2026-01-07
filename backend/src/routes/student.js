import express from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { otpLimiter } from '../middleware/rateLimit.js';
import { generateOtp, verifyOtp } from '../utils/otp.js';
import { sendOtpEmail } from '../utils/email.js';
import { ipInCidr } from '../utils/ip.js';
import { verifyWindowSeconds } from '../utils/webauthn.js';

const router = express.Router();

// Generate OTP (emailed) for an active session
router.post(
  '/generate-otp',
  requireAuth(['student']),
  otpLimiter,
  body('sessionId').isInt(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { sessionId } = req.body;
    try {
      const { rows: srows } = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
      const ses = srows[0];
      if (!ses) return res.status(404).json({ error: 'Session not found' });
      if (ses.status !== 'active') return res.status(400).json({ error: 'Session not active' });
      if (new Date(ses.end_time).getTime() < Date.now()) return res.status(400).json({ error: 'Session expired' });

      const ttlSec = Math.min(120, Math.floor((new Date(ses.end_time).getTime() - Date.now()) / 1000));
      const { plain, hash, expiresAt } = generateOtp(Math.max(ttlSec, 30));
      await query(
        `INSERT INTO otp_requests (session_id, student_id, otp_hash, expires_at, used)
         VALUES ($1, $2, $3, $4, false)`,
        [sessionId, req.user.id, hash, expiresAt]
      );

      // email OTP
      const { rows: urows } = await query('SELECT email FROM users WHERE id = $1', [req.user.id]);
      const email = urows[0]?.email;
      const domains = (process.env.INSTITUTION_EMAIL_DOMAIN || '').split(',').map(s=>s.trim()).filter(Boolean);
      if (domains.length && !domains.some(d => email.toLowerCase().endsWith(d.toLowerCase()))) {
        return res.status(400).json({ error: 'Email not within allowed institution domain' });
      }
      await sendOtpEmail(email, plain, sessionId);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to generate OTP' });
    }
  }
);

// Submit attendance: checks subnet, WebAuthn verification window, and OTP
router.post(
  '/submit-attendance',
  requireAuth(['student']),
  body('sessionId').isInt(),
  body('otp').isString().isLength({ min: 4, max: 10 }).trim().escape(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { sessionId, otp } = req.body;
    try {
      const { rows: srows } = await query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
      const ses = srows[0];
      if (!ses) return res.status(404).json({ error: 'Session not found' });
      if (ses.status !== 'active') return res.status(400).json({ error: 'Session not active' });
      const now = Date.now();
      if (new Date(ses.start_time).getTime() > now || new Date(ses.end_time).getTime() < now) {
        return res.status(400).json({ error: 'Outside session time' });
      }

      // IP subnet check
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
      if (!ipInCidr(ip, ses.subnet)) return res.status(403).json({ error: 'Not on permitted network' });

      // Validate OTP (not used, not expired)
      const { rows: orows } = await query(
        `SELECT id, otp_hash FROM otp_requests
         WHERE session_id = $1 AND student_id = $2 AND used = false AND expires_at > NOW()
         ORDER BY id DESC LIMIT 5`,
        [sessionId, req.user.id]
      );
      let validRow = null;
      for (const row of orows) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await verifyOtp(otp, row.otp_hash);
        if (ok) { validRow = row; break; }
      }
      if (!validRow) return res.status(400).json({ error: 'Invalid or expired OTP' });

      // Mark OTP used and log attendance
      await query('UPDATE otp_requests SET used = true WHERE id = $1', [validRow.id]);
      await query(
        `INSERT INTO attendance (session_id, student_id, otp_hash, credential_id, timestamp)
         VALUES ($1, $2, $3, NULL, NOW())
         ON CONFLICT (session_id, student_id) DO NOTHING`,
        [sessionId, req.user.id, validRow.otp_hash]
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to submit attendance' });
    }
  }
);

// Student history
router.get('/history', requireAuth(['student']), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.id, a.timestamp, a.session_id, s.ssid, c.code AS course_code, c.name AS course_name
       FROM attendance a JOIN sessions s ON a.session_id = s.id
       LEFT JOIN courses c ON s.course_id = c.id
       WHERE a.student_id = $1 ORDER BY a.timestamp DESC LIMIT 100`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Grouped history per course, optional CSV
router.get('/history-grouped', requireAuth(['student']), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.id as course_id, c.code, c.name, DATE(a.timestamp) as day
       FROM attendance a
       JOIN sessions s ON a.session_id = s.id
       LEFT JOIN courses c ON s.course_id = c.id
       WHERE a.student_id = $1 AND c.id IS NOT NULL
       ORDER BY day ASC`,
      [req.user.id]
    );
    const byCourse = new Map();
    const datesSet = new Set();
    rows.forEach(r => {
      const d = r.day.toISOString().slice(0,10);
      datesSet.add(d);
      if (!byCourse.has(r.course_id)) byCourse.set(r.course_id, { code: r.code, name: r.name, days: new Set() });
      byCourse.get(r.course_id).days.add(d);
    });
    const dates = Array.from(datesSet).sort();
    if ((req.query.format || '').toLowerCase() === 'csv') {
      const header = ['course_code','course_name', ...dates];
      const table = [];
      for (const [_, v] of byCourse.entries()) {
        table.push([v.code, v.name, ...dates.map(d => v.days.has(d) ? 'Y' : 'N')]);
      }
      const { stringify } = await import('csv-stringify/sync');
      const csv = stringify(table, { header: true, columns: header });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=my-attendance-by-course.csv');
      return res.send(csv);
    }
    const out = [];
    for (const [courseId, v] of byCourse.entries()) {
      out.push({ courseId, code: v.code, name: v.name, dates: Array.from(v.days).sort() });
    }
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch grouped history' });
  }
});

// List available courses/sessions visible from student's current network
router.get('/available-courses', requireAuth(['student']), async (req, res) => {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const { rows } = await query(
      `SELECT s.id as session_id, s.ssid, s.end_time, c.id as course_id, c.name, c.code, s.subnet
       FROM sessions s JOIN courses c ON s.course_id = c.id
       WHERE s.status = 'active' AND NOW() BETWEEN s.start_time AND s.end_time
       ORDER BY s.end_time ASC`
    );
    const filtered = rows.filter(r => ipInCidr(ip, r.subnet)).map(r => ({
      sessionId: r.session_id,
      courseId: r.course_id,
      name: r.name,
      code: r.code,
      ssid: r.ssid,
      endsAt: r.end_time,
    }));
    res.json(filtered);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load available courses' });
  }
});

export default router;
