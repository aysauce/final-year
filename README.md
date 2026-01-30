Secure Web-Based Attendance Verification System (Nigeria Tertiary Institutions)
===============================================================================

Overview
--------
- Three-tier architecture: Frontend (HTML/CSS/JS), Backend (Node.js + Express), Database (PostgreSQL).
- Core security: teacher-controlled sessions (1-10 minutes), OTPs, WebAuthn device binding for students, Wi-Fi subnet enforcement, HTTPS-ready headers.
- Role-based dashboards: student, teacher, and admin.

Key Features
------------
- Student signup with surname/first name/last name, email, matric, password + WebAuthn registration.
- Teacher signup page creates teacher accounts (public route) and auto-logs in.
- Login accepts email or matric/staff ID + password (case-insensitive; supports IDs like 22/1054).
- OTP email includes course code and the student name; OTP TTL follows session duration (capped).
- Student history: last 7 across all courses by default; filter by course and date range.
- Teacher course management: add, update, or drop courses; changes reflect across student views.
- Live attendance: teacher sees student name + matric.

Quick Start
-----------
1. Requirements: Node 18+, PostgreSQL 13+, npm, a `.env` file.
2. Create the DB and run `sql/schema.sql`, then apply incremental updates in `sql/updates/` (including `004_add_user_names.sql`).
3. Duplicate `backend/.env.example` -> `backend/.env`, set values (API port, DB URL, SMTP, WebAuthn config).
4. Backend:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
5. Frontend: serve `frontend/` (VS Code Live Server, XAMPP, or `npx serve frontend -p 5173`). Update `frontend/js/config.js` if the API runs on a different origin.

Environment Variables (backend/.env)
------------------------------------
- `PORT=5000`
- `DATABASE_URL=postgres://attendance_user:Pass@localhost:4000/attendance`
- `JWT_SECRET=change_me`
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
- `INSTITUTION_EMAIL_DOMAIN=edu.ng` (comma-separated list allowed)
- `TRUST_PROXY=true|false`
- `ENFORCE_HTTPS=false`
- `WEBAUTHN_RP_NAME=Secure Attendance`
- `WEBAUTHN_RP_ID=localhost` (or your prod domain)
- `WEBAUTHN_ORIGIN=http://localhost:5000`
- `WEBAUTHN_VERIFY_WINDOW_SECS=120`

Auth & Identity
---------------
- Login accepts:
  - Students: email or matric number + password
  - Teachers: email or staff ID + password
  - Admins: email or staff ID + password
- Identifiers are normalized server-side:
  - Email is stored lowercase.
  - Matric/staff IDs are stored uppercase.
  - IDs with slashes (e.g., `22/1054`) are supported.

Teacher Flow
------------
- Login with staff email/staff ID + password.
- Create/manage courses, then start attendance per course (duration 1-10 min). Subnet CIDR auto-detected from the network the teacher is on.
- Update or drop courses from the Courses section (updates reflect in student views).
- Monitor attendees in real time and download:
  - Session CSV (single session log)
  - Course report CSV (rows = students, columns = dates, Y/N)
- Pause/resume/end sessions at any time; countdown timer reflects state.

Student Flow
------------
- Visit `signup.html`, create an account (surname, first name, last name, email, matric, password), and register the device with WebAuthn during onboarding. That first device becomes the trusted authenticator.
- During login, students can use email or matric number + password. Students must use their registered WebAuthn credential when required.
- Join a session only if on the same Wi-Fi subnet as the teacher; request OTP (rate-limited, delivered via email) and submit it to log attendance.
- View attendance history: default shows last 7 across all courses; filter by course and date range for more.

Admin Flow
----------
- Login with `test@admin.edu.ng` / `password` via the main login page (admins skip WebAuthn).
- Land on `admin.html`, which provides:
  - Dashboard overview (counts for students, teachers, courses, sessions)
  - Student management: create/edit/delete, reset WebAuthn credentials, change passwords
  - Teacher management: create/edit/delete, change passwords
  - Course CRUD (assign to teachers)
  - Session oversight: view/close sessions and inspect attendance

OTP Email Format
----------------
- Subject: `Your Attendance OTP - <COURSE CODE>`
- Body:
  - "Hello, <Surname> <Firstname>,"
  - "This OTP is unique to you and lasts for less than <minutes> minutes, use it now:"

Security Notes
--------------
- HTTPS/TLS: terminate TLS at your edge and set `TRUST_PROXY=true` so Express sees real client IPs.
- Input hardening: Helmet supplies security headers; express-validator sanitizes payloads.
- OTPs: random 6-digit codes hashed with bcrypt, short-lived and tied to session duration (capped).
- Rate limiting: 3 OTP requests per minute per user.
- WebAuthn device binding: students can only log in from previously registered devices; admins manage resets when re-provisioning is needed.
- Wi-Fi enforcement: the server checks client IP (`req.ip`) against the subnet configured by the teacher. Browsers cannot read SSID directly.

Testing Data
------------
- Admin: `test@admin.edu.ng` / `password`
- Teacher: `teacher1@demo.edu.ng` / `Passw0rd!` (staff ID `TCH1001`)
- Student: `stu1001@demo.edu.ng` (matric `STU1001`) / `Passw0rd!`

Runbook
-------
1. `cd backend && npm run dev`
2. Serve `frontend/` (Live Server or `npx serve frontend -p 5173`)
3. Teacher: create a course, start attendance (subnet auto). Students: sign up (WebAuthn registration), log in, request OTP, submit.

Database Updates
----------------
- Apply migrations in `sql/updates/` in order.
- Latest migration adds student name fields:
  - `sql/updates/004_add_user_names.sql`

Deployment Tips
---------------
- Recommended PaaS: Render, Railway, Koyeb, Fly.io (+ managed Postgres). Enable HTTPS and `TRUST_PROXY=true`.
- Use a transactional SMTP provider (Mailersend, SendGrid). In dev, if SMTP is unset, emails log to the console.
- Horizontal scaling works (stateless API). Use pgbouncer or managed connection pooling.

Accessibility
-------------
- WCAG 2.1 AA: semantic HTML, focus states, color contrast. Buttons and forms are keyboard accessible.

Notes & Limitations
-------------------
- Browsers cannot expose Wi-Fi SSID; subnet verification uses client IP (ensure reverse proxies forward IP correctly).
- WebAuthn still relies on users registering or authorizing their authenticator. Provide an admin "reset device" flow (already built) before re-registering a new device.
- For higher assurance, integrate AP controller hooks or client TLS certificates if you control all devices.
"# final-year"
