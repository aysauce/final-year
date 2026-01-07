import speakeasy from 'speakeasy';
import bcrypt from 'bcrypt';

// Generate a short‑lived OTP and return { plain, hash, expiresAt }
export function generateOtp(ttlSeconds = 120) {
  const secret = speakeasy.generateSecret({ length: 20 });
  const token = speakeasy.totp({ secret: secret.base32, digits: 6, step: 30 });
  const plain = token;
  const hash = bcrypt.hashSync(String(plain), 10);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  return { plain, hash, expiresAt };
}

export async function verifyOtp(plain, hash) {
  return bcrypt.compare(String(plain), hash);
}

