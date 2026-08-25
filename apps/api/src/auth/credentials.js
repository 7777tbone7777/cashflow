/**
 * Passwords and tokens.
 *
 * Node's own crypto rather than bcrypt and jsonwebtoken, because everything
 * needed here is in the standard library and an auth dependency is a supply
 * chain you have to keep watching. scrypt is the hash the Node docs point at
 * for passwords, and a session is an opaque random token rather than a signed
 * claim — which means signing out and revoking access actually take effect,
 * instead of leaving a valid token in the wild until it expires.
 */

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// Deliberately slow. These are the parameters Node documents as interactive-
// login grade; raising N is the knob if hardware gets cheaper.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return [
    'scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString('base64'), key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, expected] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expectedKey = Buffer.from(expected, 'base64');
    const key = await scrypt(password, Buffer.from(salt, 'base64'), expectedKey.length,
      { N: Number(N), r: Number(r), p: Number(p) });
    // Constant time: a fast rejection tells an attacker how much of the hash matched.
    return crypto.timingSafeEqual(key, expectedKey);
  } catch {
    return false;
  }
}

/** A credential to hand out, plus the hash to keep. Only the hash is stored. */
export function newToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Minimal cookie parsing — one header, no dependency. */
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}
