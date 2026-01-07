// Heuristically derive a reasonable CIDR from an IPv4 address.
// - 10.x.x.x  -> /16
// - 172.16-31 -> /16
// - 192.168.x -> /24
// - 100.64-127-> /16 (CGNAT)
// else        -> /32

function normalizeIp(ip) {
  if (!ip) return null;
  const s = String(ip).trim();
  if (s === '::1') return '127.0.0.1';
  if (s.includes(':') && s.includes('.')) return s.split(':').pop();
  return s.includes(':') ? null : s; // IPv6 not supported
}

export function deriveSubnetFromIp(rawIp) {
  const ip = normalizeIp(rawIp);
  if (!ip) return { ip: rawIp || '', subnet: '0.0.0.0/0', note: 'Unsupported IP family; fallback to open subnet.' };
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
    return { ip, subnet: '0.0.0.0/0', note: 'Invalid IPv4; fallback to open subnet.' };
  }
  const [a,b] = parts;
  if (a === 10) return { ip, subnet: `${a}.${b}.0.0/16`, note: 'Derived from 10.x.x.x private range.' };
  if (a === 192 && b === 168) return { ip, subnet: `${a}.${b}.${parts[2]}.0/24`, note: 'Derived from 192.168.x.x private range.' };
  if (a === 172 && b >= 16 && b <= 31) return { ip, subnet: `${a}.${b}.0.0/16`, note: 'Derived from 172.16-31.x private range.' };
  if (a === 100 && b >= 64 && b <= 127) return { ip, subnet: `${a}.${b}.0.0/16`, note: 'Derived from CGNAT 100.64.0.0/10.' };
  // localhost
  if (ip === '127.0.0.1') return { ip, subnet: '0.0.0.0/0', note: 'Localhost detected; open subnet for local testing.' };
  return { ip, subnet: `${ip}/32`, note: 'Public IP detected; using /32 (strict). Consider setting your campus subnet.' };
}

