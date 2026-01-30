CREATE TABLE IF NOT EXISTS device_cooldowns (
  device_id TEXT PRIMARY KEY,
  cooldown_until TIMESTAMP NOT NULL
);
