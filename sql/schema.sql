-- PostgreSQL schema for Secure Attendance

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for future encryption if needed

-- Courses
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  pass_mark INTEGER NOT NULL DEFAULT 75,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, code)
);

-- Users: students and teachers
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
  surname TEXT,
  first_name TEXT,
  middle_name TEXT,
  middle_name TEXT,
  title TEXT,
  sex TEXT,
  matric_number TEXT UNIQUE,
  staff_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  hashed_password TEXT NOT NULL,
  webauthn_current_challenge TEXT,
  webauthn_verified_at TIMESTAMP,
  webauthn_verified_credential TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[],
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Sessions created by teachers
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  duration INTEGER NOT NULL,
  ssid TEXT NOT NULL,
  subnet TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','paused','closed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Attendance logs
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  credential_id TEXT,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, student_id)
);

-- OTP requests (hashed), short-lived
CREATE TABLE IF NOT EXISTS otp_requests (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Password reset codes (students/teachers)
CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

-- Per-device login cooldowns (device_id stored in browser localStorage)
CREATE TABLE IF NOT EXISTS device_cooldowns (
  device_id TEXT PRIMARY KEY,
  cooldown_until TIMESTAMP NOT NULL
);

-- Seed demo users
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'teacher1@demo.edu.ng') THEN
    INSERT INTO users (role, staff_id, email, hashed_password)
    VALUES ('teacher', 'TCH1001', 'teacher1@demo.edu.ng', crypt('Passw0rd!', gen_salt('bf')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'stu1001@demo.edu.ng') THEN
    INSERT INTO users (role, matric_number, email, hashed_password)
    VALUES ('student', 'STU1001', 'stu1001@demo.edu.ng', crypt('Passw0rd!', gen_salt('bf')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'test@admin.edu.ng') THEN
    INSERT INTO users (role, staff_id, email, hashed_password)
    VALUES ('admin', 'ADM0001', 'test@admin.edu.ng', crypt('password', gen_salt('bf')));
  END IF;
END $$;

-- Ensure ownership and privileges for application role
DO $$
DECLARE r_exists BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendance_user') INTO r_exists;
  IF r_exists THEN
    -- Transfer ownership to app role (if created by postgres)
    ALTER SCHEMA public OWNER TO attendance_user;
    ALTER TABLE IF EXISTS users OWNER TO attendance_user;
    ALTER TABLE IF EXISTS sessions OWNER TO attendance_user;
    ALTER TABLE IF EXISTS attendance OWNER TO attendance_user;
    ALTER TABLE IF EXISTS otp_requests OWNER TO attendance_user;
    ALTER TABLE IF EXISTS webauthn_credentials OWNER TO attendance_user;

    -- Grant privileges on existing objects
    GRANT USAGE, CREATE ON SCHEMA public TO attendance_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO attendance_user;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO attendance_user;

    -- Grant privileges on future objects
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO attendance_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO attendance_user;
  END IF;
END $$;
