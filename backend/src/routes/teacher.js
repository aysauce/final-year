import express from 'express';
import { body, validationResult, param } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { stringify } from 'csv-stringify/sync';
import { deriveSubnetFromIp } from '../utils/subnet.js';

const router = express.Router();

// Create a course
router.post(
  '/courses',
  requireAuth(['teacher']),
  body('name').isString().trim().isLength({ min: 2 }).escape(),
  body('code').isString().trim().isLength({ min: 2, max: 20 }).escape(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { name, code } = req.body;
    try {
      const { rows } = await query(
        `INSERT INTO courses (teacher_id, name, code) VALUES ($1, $2, $3)
         ON CONFLICT (teacher_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name, code, created_at`,
        [req.user.id, name, code]
      );
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create course' });
    }
  }
);

// List teacher courses
router.get('/courses', requireAuth(['teacher']), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, code, created_at FROM courses WHERE teacher_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

// Create session
router.post(
  '/create-session',
  requireAuth(['teacher']),
  body('duration').isInt({ min: 1, max: 10 }),
  body('ssid').optional().isString().trim().escape(),
  body('subnet').optional().isString().trim(), // omitted or 'auto' -> derive
  body('courseId').isInt({ min: 1 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    let { ssid } = req.body;
    const { duration, courseId } = req.body;
    let { subnet } = req.body;
    const start = new Date();
    const end = new Date(start.getTime() + duration * 60000);
    try {
      // Default SSID to course code if not provided
      if (!ssid) {
        const { rows: crows } = await query('SELECT code, name FROM courses WHERE id = $1 AND teacher_id = $2', [courseId, req.user.id]);
        if (!crows[0]) return res.status(404).json({ error: 'Course not found' });
        ssid = crows[0].code || crows[0].name || 'Class';
      }
      if (!subnet || String(subnet).toLowerCase() === 'auto') {
        const rawIp = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
        const d = deriveSubnetFromIp(rawIp);
        subnet = d.subnet;
      }
      const { rows } = await query(
        `INSERT INTO sessions (teacher_id, course_id, start_time, end_time, duration, ssid, subnet, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
          RETURNING id, start_time, end_time, status`,
        [req.user.id, courseId, start, end, duration, ssid, subnet]
      );
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create session' });
    }
  }
);

// Suggest subnet from teacher's current IP
router.get('/suggest-network', requireAuth(['teacher']), async (req, res) => {
  const rawIp = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  const d = deriveSubnetFromIp(rawIp);
  res.json(d);
});

// Pause session
router.post(
  '/pause-session',
  requireAuth(['teacher']),
  body('sessionId').isInt(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { sessionId } = req.body;
    try {
      const { rows } = await query(
        `UPDATE sessions
         SET status = CASE WHEN status='active' THEN 'paused' ELSE 'active' END
         WHERE id = $1 AND teacher_id = $2
         RETURNING status`,
        [sessionId, req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
      res.json({ status: rows[0].status });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to toggle pause' });
    }
  }
);

// End session
router.post(
  '/end-session',
  requireAuth(['teacher']),
  body('sessionId').isInt(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { sessionId } = req.body;
    try {
      const { rows } = await query(
        `UPDATE sessions SET status = 'closed', end_time = NOW()
         WHERE id = $1 AND teacher_id = $2
         RETURNING status, end_time`,
        [sessionId, req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Session not found' });
      res.json({ status: rows[0].status, end_time: rows[0].end_time });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to end session' });
    }
  }
);

// Get session attendance
router.get(
  '/get-attendance/:sessionId',
  requireAuth(['teacher']),
  param('sessionId').isInt(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { sessionId } = req.params;
    try {
      const { rows } = await query(
        `SELECT a.id, a.timestamp, a.credential_id, u.email, u.matric_number, c.code AS course_code, c.name AS course_name
         FROM attendance a
         JOIN users u ON a.student_id = u.id
         JOIN sessions s ON a.session_id = s.id
         LEFT JOIN courses c ON s.course_id = c.id
         WHERE a.session_id = $1
         ORDER BY a.timestamp ASC`,
        [sessionId]
      );
      if ((req.query.format || '').toLowerCase() === 'csv') {
        const csv = stringify(rows, { header: true });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance-${sessionId}.csv`);
        return res.send(csv);
      }
      res.json(rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to fetch attendance' });
    }
  }
);

// Course-level CSV report: rows = students, columns = dates (Y/N)
router.get('/course-report/:courseId', requireAuth(['teacher']), async (req, res) => {
  const courseId = parseInt(req.params.courseId, 10);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course' });
  try {
    // Ensure teacher owns this course
    const { rows: owns } = await query('SELECT id, code, name FROM courses WHERE id=$1 AND teacher_id=$2', [courseId, req.user.id]);
    const course = owns[0];
    if (!course) return res.status(404).json({ error: 'Course not found' });

    // Load attendance for this course
    const { rows } = await query(
      `SELECT u.matric_number, u.email, DATE(a.timestamp) AS day
       FROM attendance a
       JOIN users u ON a.student_id = u.id
       JOIN sessions s ON a.session_id = s.id
       WHERE s.course_id = $1
       ORDER BY day ASC`,
      [courseId]
    );
    if (!rows.length) {
      const csv = stringify([], { header: true, columns: ['matric_number','email'] });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=course-${course.code}-report.csv`);
      return res.send(csv);
    }
    const dates = Array.from(new Set(rows.map(r => r.day.toISOString().slice(0,10)))).sort();
    const byStudent = new Map();
    rows.forEach(r => {
      const key = r.matric_number || r.email;
      if (!byStudent.has(key)) byStudent.set(key, { matric_number: r.matric_number || '', email: r.email || '', days: new Set() });
      byStudent.get(key).days.add(r.day.toISOString().slice(0,10));
    });
    const header = ['matric_number','email', ...dates];
    const table = [];
    for (const v of byStudent.values()) {
      const row = [v.matric_number, v.email, ...dates.map(d => v.days.has(d) ? 'Y' : 'N')];
      table.push(row);
    }
    const csv = stringify(table, { header: true, columns: header });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=course-${course.code}-report.csv`);
    return res.send(csv);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to build course report' });
  }
});

export default router;
