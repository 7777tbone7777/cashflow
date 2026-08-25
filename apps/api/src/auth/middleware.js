/**
 * Who is asking, and are they allowed to see this production.
 *
 * The ownership check is wired through `router.param` rather than being called
 * at the top of each handler. There are nineteen routes that take a production
 * id, and a check you have to remember to write is one that eventually gets
 * left out of route twenty — at which point the id is the only thing standing
 * between one customer's budget and another's.
 */

import { prisma } from '../db.js';
import { hashToken, readCookie } from './credentials.js';

export const SESSION_COOKIE = 'cashflow_session';
export const SESSION_DAYS = 30;

export function sessionCookie(token, { clear = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  // Railway terminates TLS, so in production the cookie should never travel
  // in the clear. Locally it must, because there is no certificate.
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

/** Resolve the session if there is one. Never rejects — that is requireAuth's job. */
export async function attachUser(req, _res, next) {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return next();
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) return next();
    req.user = session.user;
    req.session = session;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  return next();
}

/**
 * Resolve a production and prove the caller owns it.
 *
 * A production nobody owns, or one owned by somebody else, both answer 404
 * rather than 403. Saying "this exists but is not yours" confirms the id is
 * real, which is a fact worth nothing to the caller and something to an
 * attacker enumerating them.
 */
export async function loadOwnedProduction(req, res, next, id) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
    const production = await prisma.production.findUnique({ where: { id } });
    if (!production || production.ownerId !== req.user.id) {
      return res.status(404).json({ error: 'Production not found.' });
    }
    req.production = production;
    return next();
  } catch (error) {
    // A malformed uuid is a not-found, not a 500.
    if (error?.code === 'P2023' || /invalid input syntax/i.test(error?.message || '')) {
      return res.status(404).json({ error: 'Production not found.' });
    }
    return next(error);
  }
}

/** Apply the ownership check to every route on this router that names a production. */
export function scopeToOwner(router, ...paramNames) {
  for (const name of paramNames) router.param(name, loadOwnedProduction);
  return router;
}
