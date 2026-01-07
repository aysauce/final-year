import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { query } from '../db.js';

const router = express.Router();

// Generic: get attendance for a session (teacher only)
router.get('/get-attendance/:sessionId', requireAuth(['teacher']), async (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  if (Number.isNaN(sessionId)) return res.status(400).json({ error: 'Invalid session' });
  try {
    const { rows } = await query(
      `SELECT a.id, a.timestamp, a.credential_id, u.email, u.matric_number
       FROM attendance a JOIN users u ON a.student_id = u.id
       WHERE a.session_id = $1
       ORDER BY a.timestamp ASC`,
      [sessionId]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

export default router;
