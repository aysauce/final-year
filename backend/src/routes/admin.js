import express from 'express';
import bcrypt from 'bcrypt';
import { body, validationResult, param } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';

const router = express.Router();

router.use(requireAuth(['admin']));

const handleValidation = (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) {
    res.status(400).json({ errors: errs.array() });
    return false;
  }
  return true;
};

// Overview stats
router.get('/overview', async (req, res) => {
  try {
    const [{ rows: studentRows }, { rows: teacherRows }, { rows: courseRows }, { rows: sessionRows }] = await Promise.all([
      query('SELECT COUNT(*)::int AS total FROM users WHERE role = \'student\''),
      query('SELECT COUNT(*)::int AS total FROM users WHERE role = \'teacher\''),
      query('SELECT COUNT(*)::int AS total FROM courses'),
      query('SELECT COUNT(*) FILTER (WHERE status = \'active\')::int AS active, COUNT(*)::int AS total FROM sessions'),
    ]);
    res.json({
      students: studentRows[0]?.total || 0,
      teachers: teacherRows[0]?.total || 0,
      courses: courseRows[0]?.total || 0,
      sessions: sessionRows[0] || { active: 0, total: 0 },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// Students CRUD ----------------------------------------------------------------
router.get('/students', async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, matric_number, created_at FROM users WHERE role = \'student\' ORDER BY created_at DESC LIMIT 200'
  );
  res.json(rows);
});

router.post(
  '/students',
  body('email').isEmail().normalizeEmail(),
  body('matricNumber').isString().trim(),
  body('password').isString().isLength({ min: 6 }),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const email = String(req.body.email || '').trim().toLowerCase();
    const matricNumber = String(req.body.matricNumber || '').trim().toUpperCase();
    const password = req.body.password;
    try {
      const hashed = await bcrypt.hash(password, 10);
      const { rows } = await query(
        `INSERT INTO users (role, email, matric_number, hashed_password)
         VALUES ('student', $1, $2, $3)
         RETURNING id, email, matric_number, created_at`,
        [email, matricNumber, hashed]
      );
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create student' });
    }
  }
);

router.put(
  '/students/:id',
  param('id').isInt(),
  body('email').optional().isEmail().normalizeEmail(),
  body('matricNumber').optional().isString().trim(),
  body('password').optional().isString().isLength({ min: 6 }),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const updates = [];
    const params = [];
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
    const matricNumber = req.body.matricNumber ? String(req.body.matricNumber).trim().toUpperCase() : null;
    const password = req.body.password;
    if (email) {
      params.push(email);
      updates.push(`email = $${params.length}`);
    }
    if (matricNumber) {
      params.push(matricNumber);
      updates.push(`matric_number = $${params.length}`);
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      params.push(hashed);
      updates.push(`hashed_password = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    try {
      await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} AND role = 'student'`,
        params
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update student' });
    }
  }
);

router.delete('/students/:id', param('id').isInt(), async (req, res) => {
  if (!handleValidation(req, res)) return;
  try {
    await query('DELETE FROM users WHERE id = $1 AND role = \'student\'', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

router.post('/students/:id/reset-credential', param('id').isInt(), async (req, res) => {
  if (!handleValidation(req, res)) return;
  try {
    await query('DELETE FROM webauthn_credentials WHERE user_id = $1', [req.params.id]);
    await query('UPDATE users SET webauthn_verified_at = NULL, webauthn_verified_credential = NULL WHERE id = $1', [
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to reset credentials' });
  }
});

// Teachers CRUD ---------------------------------------------------------------
router.get('/teachers', async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, staff_id, created_at FROM users WHERE role = \'teacher\' ORDER BY created_at DESC LIMIT 200'
  );
  res.json(rows);
});

router.post(
  '/teachers',
  body('email').isEmail().normalizeEmail(),
  body('staffId').isString().trim(),
  body('password').isString().isLength({ min: 6 }),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const email = String(req.body.email || '').trim().toLowerCase();
    const staffId = String(req.body.staffId || '').trim().toUpperCase();
    const password = req.body.password;
    try {
      const hashed = await bcrypt.hash(password, 10);
      const { rows } = await query(
        `INSERT INTO users (role, email, staff_id, hashed_password)
         VALUES ('teacher', $1, $2, $3)
         RETURNING id, email, staff_id, created_at`,
        [email, staffId, hashed]
      );
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create teacher' });
    }
  }
);

router.put(
  '/teachers/:id',
  param('id').isInt(),
  body('email').optional().isEmail().normalizeEmail(),
  body('staffId').optional().isString().trim(),
  body('password').optional().isString().isLength({ min: 6 }),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const updates = [];
    const params = [];
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
    const staffId = req.body.staffId ? String(req.body.staffId).trim().toUpperCase() : null;
    const password = req.body.password;
    if (email) {
      params.push(email);
      updates.push(`email = $${params.length}`);
    }
    if (staffId) {
      params.push(staffId);
      updates.push(`staff_id = $${params.length}`);
    }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      params.push(hashed);
      updates.push(`hashed_password = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    try {
      await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} AND role = 'teacher'`,
        params
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update teacher' });
    }
  }
);

router.delete('/teachers/:id', param('id').isInt(), async (req, res) => {
  if (!handleValidation(req, res)) return;
  try {
    await query('DELETE FROM users WHERE id = $1 AND role = \'teacher\'', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete teacher' });
  }
});

// Courses ----------------------------------------------------------------------
router.get('/courses', async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.code, c.name, c.teacher_id, u.email AS teacher_email
     FROM courses c
     JOIN users u ON c.teacher_id = u.id
     ORDER BY c.created_at DESC`
  );
  res.json(rows);
});

router.post(
  '/courses',
  body('name').isString().trim().escape(),
  body('code').isString().trim().escape(),
  body('teacherId').isInt(),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const { name, code, teacherId } = req.body;
    try {
      const { rows } = await query(
        `INSERT INTO courses (name, code, teacher_id)
         VALUES ($1, $2, $3)
         RETURNING id, name, code, teacher_id`,
        [name, code, teacherId]
      );
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create course' });
    }
  }
);

router.put(
  '/courses/:id',
  param('id').isInt(),
  body('name').optional().isString().trim().escape(),
  body('code').optional().isString().trim().escape(),
  body('teacherId').optional().isInt(),
  async (req, res) => {
    if (!handleValidation(req, res)) return;
    const updates = [];
    const params = [];
    const { name, code, teacherId } = req.body;
    if (name) {
      params.push(name);
      updates.push(`name = $${params.length}`);
    }
    if (code) {
      params.push(code);
      updates.push(`code = $${params.length}`);
    }
    if (teacherId) {
      params.push(teacherId);
      updates.push(`teacher_id = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.params.id);
    try {
      await query(
        `UPDATE courses SET ${updates.join(', ')} WHERE id = $${params.length}`,
        params
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update course' });
    }
  }
);

router.delete('/courses/:id', param('id').isInt(), async (req, res) => {
  if (!handleValidation(req, res)) return;
  try {
    await query('DELETE FROM courses WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// Sessions ---------------------------------------------------------------------
router.get('/sessions', async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.status, s.start_time, s.end_time, s.duration, s.ssid,
            c.code AS course_code, c.name AS course_name, u.email AS teacher_email
     FROM sessions s
     LEFT JOIN courses c ON s.course_id = c.id
     LEFT JOIN users u ON s.teacher_id = u.id
     ORDER BY s.start_time DESC
     LIMIT 200`
  );
  res.json(rows);
});

router.post('/sessions/:id/close', param('id').isInt(), async (req, res) => {
  if (!handleValidation(req, res)) return;
  try {
    await query('UPDATE sessions SET status = \'closed\', end_time = NOW() WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to close session' });
  }
});

router.get('/sessions/:id/attendance', param('id').isInt(), async (req, res) => {
  if (!handleValidation(req, res)) return;
  try {
    const { rows } = await query(
      `SELECT a.id, a.timestamp, u.email, u.matric_number
       FROM attendance a
       JOIN users u ON a.student_id = u.id
       WHERE a.session_id = $1
       ORDER BY a.timestamp ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load attendance' });
  }
});

export default router;
