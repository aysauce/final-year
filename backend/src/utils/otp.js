import crypto from 'crypto';
import bcrypt from 'bcrypt';

// Generate a short-lived OTP and return { plain, hash, expiresAt }
export function generateOtp(ttlSeconds = 120) {
  const plain = String(crypto.randomInt(100000, 1000000));
  const hash = bcrypt.hashSync(String(plain), 10);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  return { plain, hash, expiresAt };
}

export async function verifyOtp(plain, hash) {
  return bcrypt.compare(String(plain), hash);
}
