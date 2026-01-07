export const rpName = process.env.WEBAUTHN_RP_NAME || 'Secure Attendance';
export const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
export const origin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:5000';
export const verifyWindowSeconds = parseInt(process.env.WEBAUTHN_VERIFY_WINDOW_SECS || '120', 10);

export function toBase64Url(buffer) {
  if (!buffer) {
    return '';
  }
  const arr = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : Buffer.from(buffer);
  return arr.toString('base64url');
}

export function fromBase64Url(value) {
  if (!value) return Buffer.alloc(0);
  return Buffer.from(value, 'base64url');
}
