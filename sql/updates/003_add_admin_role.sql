-- Allow admin role and seed default admin account
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('student','teacher','admin'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'test@admin.edu.ng') THEN
    INSERT INTO users (role, staff_id, email, hashed_password)
    VALUES ('admin', 'ADM0001', 'test@admin.edu.ng', crypt('password', gen_salt('bf')));
  END IF;
END $$;
