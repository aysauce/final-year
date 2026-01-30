import express from 'express';
import { body, validationResult, param } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { deriveSubnetFromIp } from '../utils/subnet.js';

const router = express.Router();

// Current teacher profile
router.get('/me', requireAuth(['teacher']), async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT surname, first_name, middle_name, title, sex FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Teacher not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Create a course
router.post(
  '/courses',
  requireAuth(['teacher']),
  body('name').isString().trim().isLength({ min: 2 }).escape(),
  body('code').isString().trim().isLength({ min: 2, max: 20 }).escape(),
  body('passMark').optional().isInt({ min: 0, max: 100 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { name, code } = req.body;
    const passMark = Number.isFinite(Number(req.body.passMark)) ? Number(req.body.passMark) : 75;
    try {
      const { rows } = await query(
        `INSERT INTO courses (teacher_id, name, code, pass_mark) VALUES ($1, $2, $3, $4)
         ON CONFLICT (teacher_id, code) DO UPDATE SET name = EXCLUDED.name, pass_mark = EXCLUDED.pass_mark
         RETURNING id, name, code, pass_mark, created_at`,
        [req.user.id, name, code, passMark]
      );
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to create course' });
    }
  }
);

// Update course
router.post(
  '/courses/:id',
  requireAuth(['teacher']),
  param('id').isInt(),
  body('name').optional().isString().trim().isLength({ min: 2 }).escape(),
  body('code').optional().isString().trim().isLength({ min: 2, max: 20 }).escape(),
  body('passMark').optional().isInt({ min: 0, max: 100 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { name, code } = req.body;
    const passMark = Number.isFinite(Number(req.body.passMark)) ? Number(req.body.passMark) : null;
    const updates = [];
    const params = [];
    if (name) {
      params.push(name);
      updates.push(`name = $${params.length}`);
    }
    if (code) {
      params.push(code);
      updates.push(`code = $${params.length}`);
    }
    if (passMark !== null) {
      params.push(passMark);
      updates.push(`pass_mark = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(req.user.id);
    params.push(req.params.id);
    try {
      const { rows } = await query(
        `UPDATE courses SET ${updates.join(', ')}
         WHERE teacher_id = $${params.length - 1} AND id = $${params.length}
         RETURNING id, name, code, pass_mark`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: 'Course not found' });
      res.json(rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to update course' });
    }
  }
);

// Delete course
router.post(
  '/courses/:id/delete',
  requireAuth(['teacher']),
  param('id').isInt(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    try {
      const { rows } = await query(
        `DELETE FROM courses WHERE id = $1 AND teacher_id = $2 RETURNING id`,
        [req.params.id, req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Course not found' });
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to delete course' });
    }
  }
);

// List teacher courses
router.get('/courses', requireAuth(['teacher']), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, code, pass_mark, created_at FROM courses WHERE teacher_id = $1 ORDER BY created_at DESC`,
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
        `SELECT a.id, a.timestamp, a.credential_id, u.surname, u.first_name, u.middle_name, u.matric_number
         FROM attendance a
         JOIN users u ON a.student_id = u.id
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

async function buildCourseAttendance(courseId, teacherId) {
  const { rows: owns } = await query('SELECT id, code, name, pass_mark FROM courses WHERE id=$1 AND teacher_id=$2', [
    courseId,
    teacherId,
  ]);
  const course = owns[0];
  if (!course) return null;

  const { rows: sessionRows } = await query(
    `SELECT s.id, s.start_time
     FROM sessions s
     JOIN attendance a ON a.session_id = s.id
     WHERE s.course_id = $1
     GROUP BY s.id
     ORDER BY s.start_time ASC`,
    [courseId]
  );

  const slots = [];
  const sessionToSlot = new Map();
  sessionRows.forEach((row) => {
    const startMs = new Date(row.start_time).getTime();
    const last = slots[slots.length - 1];
    if (!last || startMs - last.startMs >= 2 * 60 * 60 * 1000) {
      slots.push({ startMs, sessionIds: [row.id] });
      sessionToSlot.set(row.id, slots.length - 1);
    } else {
      last.sessionIds.push(row.id);
      sessionToSlot.set(row.id, slots.length - 1);
    }
  });

  const dateCounts = {};
  slots.forEach((slot) => {
    const dateStr = new Date(slot.startMs).toISOString().slice(0, 10);
    dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
  });
  const dateSeen = {};
  const slotLabels = slots.map((slot) => {
    const dateStr = new Date(slot.startMs).toISOString().slice(0, 10);
    dateSeen[dateStr] = (dateSeen[dateStr] || 0) + 1;
    if (dateCounts[dateStr] > 1) {
      const suffix = String.fromCharCode(64 + dateSeen[dateStr]);
      return `${dateStr} ${suffix}`;
    }
    return dateStr;
  });

  const { rows: attendanceRows } = await query(
    `SELECT a.student_id, a.session_id, u.surname, u.first_name, u.middle_name, u.matric_number
     FROM attendance a
     JOIN sessions s ON a.session_id = s.id
     JOIN users u ON a.student_id = u.id
     WHERE s.course_id = $1
     ORDER BY s.start_time ASC`,
    [courseId]
  );

  const byStudent = new Map();
  attendanceRows.forEach((row) => {
    const slotIndex = sessionToSlot.get(row.session_id);
    if (slotIndex === undefined) return;
    if (!byStudent.has(row.student_id)) {
      byStudent.set(row.student_id, {
        surname: row.surname || '',
        first_name: row.first_name || '',
        middle_name: row.middle_name || '',
        matric_number: row.matric_number || '',
        slots: Array(slots.length).fill(false),
      });
    }
    byStudent.get(row.student_id).slots[slotIndex] = true;
  });

  const totalSlots = slots.length;
  const students = Array.from(byStudent.values()).map((s) => {
    const attended = s.slots.filter(Boolean).length;
    const percent = totalSlots ? (attended / totalSlots) * 100 : 0;
    const status = percent >= (course.pass_mark || 0) ? 'passed' : 'failed';
    return {
      surname: s.surname,
      first_name: s.first_name,
      middle_name: s.middle_name,
      matric_number: s.matric_number,
      attended,
      total: totalSlots,
      status,
      slots: s.slots,
    };
  }).sort((a, b) => {
    const aName = `${a.surname} ${a.first_name} ${a.middle_name}`.trim().toLowerCase();
    const bName = `${b.surname} ${b.first_name} ${b.middle_name}`.trim().toLowerCase();
    return aName.localeCompare(bName);
  });

  return { course, slots: slotLabels, students };
}

// Course attendance report (JSON or XLSX)
router.get('/course-attendance/:courseId', requireAuth(['teacher']), async (req, res) => {
  const courseId = parseInt(req.params.courseId, 10);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course' });
  try {
    const data = await buildCourseAttendance(courseId, req.user.id);
    if (!data) return res.status(404).json({ error: 'Course not found' });

    if ((req.query.format || '').toLowerCase() === 'xlsx') {
      const scale = Number(req.query.scale);
      const useScale = Number.isFinite(scale) && scale > 0;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Attendance');
      const baseColumns = ['Surname', 'First Name', 'Middle Name', 'Matric', ...data.slots, 'Total (Attendances)'];
      const columns = useScale ? [...baseColumns, `Score (out of ${scale})`] : baseColumns;

      ws.addRow([`${data.course.name} (${data.course.code})`]);
      ws.mergeCells(1, 1, 1, columns.length);
      ws.getRow(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1B6EDC' } };
      ws.addRow([]);

      const headerRow = ws.addRow(columns);
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2E8F0' } };

      data.students.forEach((s) => {
        const marks = s.slots.map((v) => (v ? '1' : '-'));
        const total = s.attended;
        const rowValues = [s.surname, s.first_name, s.middle_name, s.matric_number, ...marks, total];
        if (useScale) {
          const score = s.total ? Math.round((s.attended / s.total) * scale) : 0;
          rowValues.push(score);
        }
        const row = ws.addRow(rowValues);
        const passed = s.status === 'passed';
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: passed ? 'DCFCE7' : 'FEE2E2' },
        };
      });

      ws.columns = columns.map((col, idx) => {
        if (idx === 0 || idx === 1 || idx === 2) return { width: 18 };
        if (idx === 3) return { width: 14 };
        return { width: 12 };
      });

      const buffer = await wb.xlsx.writeBuffer();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=course-${data.course.code}-attendance.xlsx`);
      return res.send(Buffer.from(buffer));
    }

    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to build course attendance' });
  }
});

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
