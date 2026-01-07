-- Add WebAuthn support
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS webauthn_current_challenge TEXT,
  ADD COLUMN IF NOT EXISTS webauthn_verified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS webauthn_verified_credential TEXT,
  DROP COLUMN IF EXISTS device_fingerprint;

ALTER TABLE attendance
  DROP COLUMN IF EXISTS device_fingerprint,
  ADD COLUMN IF NOT EXISTS credential_id TEXT;

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[],
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='attendance_user') THEN
    ALTER TABLE IF EXISTS webauthn_credentials OWNER TO attendance_user;
  END IF;
END $$;
