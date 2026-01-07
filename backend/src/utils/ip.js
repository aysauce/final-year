// Minimal IPv4 CIDR check without external deps.
// - Supports IPv4 addresses and IPv4-mapped IPv6 (e.g., ::ffff:192.168.1.10)
// - CIDR must be IPv4 (e.g., 192.168.0.0/16)

function ipv4ToLong(v4) {
  const parts = v4.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function normalizeIp(ip) {
  if (!ip) return null;
  const s = String(ip).trim();
  if (s === '::1') return '127.0.0.1';
  // IPv4-mapped IPv6 like ::ffff:192.168.1.10
  if (s.includes(':') && s.includes('.')) {
    const last = s.split(':').pop();
    return last;
  }
  // Plain IPv4
  if (!s.includes(':')) return s;
  // Pure IPv6 not supported here
  return null;
}

export function ipInCidr(ip, cidr) {
  try {
    const norm = normalizeIp(ip);
    if (!norm) return false;
    const [base, prefixStr] = cidr.split('/');
    const prefix = Number(prefixStr);
    if (!base || Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;
    const ipL = ipv4ToLong(norm);
    const baseL = ipv4ToLong(base);
    if (ipL == null || baseL == null) return false;
    const mask = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
    return (ipL & mask) === (baseL & mask);
  } catch {
    return false;
  }
}
