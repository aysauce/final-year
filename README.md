Secure Web-Based Attendance Verification System (Nigeria Tertiary Institutions)
===============================================================================

Overview
--------
- Three-tier architecture: Frontend (HTML/CSS/JS), Backend (Node.js + Express), Database (PostgreSQL).
- Core security: teacher-controlled sessions (1-10 minutes), OTPs, WebAuthn device binding for students, Wi-Fi subnet enforcement, HTTPS-ready headers.
- Role-based dashboards: student, teacher, and minimal admin (reset WebAuthn only).

Key Features
------------
- Student signup with surname, first name, middle name, email, matric, password + WebAuthn setup.
- Teacher signup page (public) captures biodata: surname, first name, middle name, position (Mr/Mrs/Miss/Dr/Prof), sex.
- Login accepts email or matric/staff ID + password (case-insensitive; supports IDs like 22/1054).
- Students without WebAuthn credentials are prompted to register a passkey immediately after password verification during login.
- Forgot password flow for students and lecturers using a time-limited email reset code.
- OTP email uses course code in subject and personalized greeting in body; OTP TTL follows session duration (capped).
- Student history: last 7 across all courses by default; filter by course and date range.
- Teacher course management: add, update, or drop courses; changes reflect across student views.
- Teacher attendance reports: course summary exports (XLSX), pass marks, pass/fail highlighting, and score scaling.
- Live attendance: teacher sees student name + matric; no device column.
- Device cooldown: per-device 10-minute cooldown enforced after student logout to reduce device hopping.

Quick Start
-----------
1. Requirements: Node 18+, PostgreSQL 13+, npm, a `.env` file.
2. Create the DB and run `sql/schema.sql`, then apply incremental updates in `sql/updates/`.
3. Duplicate `backend/.env.example` -> `backend/.env`, set values (API port, DB URL, SMTP, WebAuthn config).
4. Backend:
   ```bash
   cd backend
   npm install
   npm run dev
   ```
5. Frontend: serve `frontend/` (VS Code Live Server, XAMPP, or `npx serve frontend -p 5173`).
   Update `frontend/js/config.js` if the API runs on a different origin.

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
- `PASSWORD_RESET_TTL_MINUTES=15`

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

WebAuthn Device Binding
-----------------------
- Students are bound to a passkey (WebAuthn) device.
- Login flow (student):
  1) Password verified.
  2) If no WebAuthn credential exists for the student, the server returns registration options and the browser creates a passkey.
  3) Credential is saved to the database and the login completes.
  4) Subsequent logins require the registered passkey (WebAuthn authentication).
- If a student loses a device, an admin resets their WebAuthn credential. The next login will prompt registration again.

Forgot Password
---------------
- Available for student and lecturer accounts from the login page.
- Step 1: enter email and request a reset code (sent by email).
- Step 2: submit the code with a new password to complete the reset.
- Codes expire after `PASSWORD_RESET_TTL_MINUTES` (default 15).
- The forgot-password screen includes show/hide toggles for both new and confirm password fields.

Device Cooldown (Per Device)
----------------------------
- When a student logs out, the device enters a 10-minute cooldown stored server-side.
- Login from that device (any account) is blocked until cooldown expires.
- Error shown: "You can log back in X min(s). Try again shortly."

Teacher Flow
------------
- Login with staff email/staff ID + password.
- Create/manage courses (name, code, level, program, pass mark, etc.).
- Update or drop courses from the Courses section; changes reflect across student views.
- Start attendance per course (duration 1-10 min). Subnet CIDR is auto-detected from the teacher network.
- Live attendance table shows student name + matric in real time.
- Session controls: pause/resume/end at any time; countdown is shown as time only (bold).

Teacher Attendance Reports
--------------------------
Course Attendance Summary
- Select a course to view a summary table (max 5 rows unless searching).
- Search by student name or matric.
- Pass mark (percent) determines pass/fail.
- Optional "Score out of" field converts attendance count to a custom scale.
- Download full course attendance as XLSX using "Download Course Attendance".

Course Attendance XLSX (Download Course Attendance)
- Title row: course name and course code (bold).
- Columns: Surname, First Name, Middle Name, Matric, session dates, Total (no of attendances), and optional score.
- Each student row is shaded green or red based on pass mark.
- Session columns are grouped by 2-hour windows per course. If the same course is held twice on the same day, columns are labeled with suffixes (e.g., 2026-01-30 A, 2026-01-30 B).

Today Attendance XLSX (Download Today's Attendance)
- Button label: "Download Today's Attendance".
- Enabled only after a session ends; available only until you start a new session or log out.
- Output styling matches the course report, but does NOT include pass/fail coloring, total, or score columns.
- Title row: course name + course code + attendance date.
- Filename includes course name/code and date.

Student Flow
------------
- Create an account with surname, first name, middle name, email, matric, password.
- Login with email or matric + password; WebAuthn passkey is required (or registered if missing).
- Use "Forgot password?" on the login page to reset your password by email.
- Student dashboard greets with "Hello <FirstName>".
- Join a session only if on the same Wi-Fi subnet as the teacher.
- Request OTP (rate-limited, delivered via email) and submit it to log attendance.
- Attendance history:
  - Default view: last 7 attendances across all courses.
  - Range filters: Last 7 attendances, Today, Yesterday, Last Week, Last Month, Custom.
  - Course selection shows lecturer name (from teacher biodata) when browsing available courses.

Admin Flow (Minimal)
--------------------
- Admin console only supports WebAuthn resets for students.
- Students are not listed until searched in the admin panel.
- Use reset to clear WebAuthn credentials; students will re-register on next login.

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
- WebAuthn is origin-bound and requires user presence/verification at the time of attendance.
- Wi-Fi enforcement: the server checks client IP (`req.ip`) against the subnet configured by the teacher.

Testing Data
------------
- Admin: `test@admin.edu.ng` / `password`
- Teacher: `teacher1@demo.edu.ng` / `Passw0rd!` (staff ID `TCH1001`)
- Student: `stu1001@demo.edu.ng` (matric `STU1001`) / `Passw0rd!`

Runbook
-------
1. `cd backend && npm run dev`
2. Serve `frontend/` (Live Server or `npx serve frontend -p 5173`)
3. Teacher: create a course, start attendance (subnet auto). Students: log in, register passkey if prompted, request OTP, submit.

Database Updates
----------------
Apply migrations in `sql/updates/` in order. Key updates include:
- `004_add_user_names.sql`: adds surname, first_name, middle_name.
- `005_add_teacher_biodata.sql`: adds title and sex for teachers.
- `006_drop_last_name.sql`: removes last_name column.
- `007_add_course_pass_mark.sql`: adds pass_mark to courses.
- `009_add_device_cooldowns.sql`: device_cooldowns table for per-device cooldown.
- `010_add_password_resets.sql`: password reset codes table.

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
- WebAuthn reset is handled via the minimal admin panel.
- For higher assurance, integrate AP controller hooks or client TLS certificates if you control all devices.
