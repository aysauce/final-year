import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import authRoutes from './routes/auth.js';
import teacherRoutes from './routes/teacher.js';
import studentRoutes from './routes/student.js';
import attendanceRoutes from './routes/attendance.js';
import webauthnRoutes from './routes/webauthn.js';
import adminRoutes from './routes/admin.js';
import passwordRoutes from './routes/password.js';

// 🟩 NEW IMPORTS — required for static frontend
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 5000;

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

app.use(helmet());
// Allow all origins (no cookies used); simplifies local dev and file://
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Optional HTTPS enforcement when behind proxy
app.use((req, res, next) => {
  if (process.env.ENFORCE_HTTPS === 'true' && req.get('x-forwarded-proto') !== 'https') {
    const url = `https://${req.get('host')}${req.originalUrl}`;
    return res.redirect(301, url);
  }
  next();
});

// Healthcheck
app.get('/health', (req, res) => res.json({ ok: true }));

// 🟩 NEW: STATIC FRONTEND SETUP
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendPath = path.join(__dirname, '../..', 'frontend');
app.use(express.static(frontendPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Fallback for direct navigation like /login or /dashboard (optional)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Friendly root route to avoid confusion in dev
// app.get('/', (req, res) => {
//   res.json({ ok: true, service: 'attendance-api', docs: ['/health', '/api/login'] });
// });

// Routes
app.use('/api', authRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', attendanceRoutes);
app.use('/api', webauthnRoutes);
app.use('/api', passwordRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

createServer(app).listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
