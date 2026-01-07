import jwt from 'jsonwebtoken';
import { query } from '../db.js';

export function requireAuth(roles = []) {
  return async function (req, res, next) {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'Unauthorized' });
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await query('SELECT id, role FROM users WHERE id = $1', [payload.sub]);
      if (!rows[0]) return res.status(401).json({ error: 'Unauthorized' });
      if (roles.length && !roles.includes(rows[0].role)) return res.status(403).json({ error: 'Forbidden' });
      req.user = { id: rows[0].id, role: rows[0].role };
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

export function signJwt(user) {
  const payload = { sub: user.id, role: user.role };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
}

