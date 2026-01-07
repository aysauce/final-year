-- Migration: add courses and link sessions
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, code)
);

ALTER TABLE IF EXISTS sessions
  ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;

-- Privileges
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendance_user') THEN
    ALTER TABLE IF EXISTS courses OWNER TO attendance_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON courses TO attendance_user;
  END IF;
END $$;

