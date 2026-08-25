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
  if (secureCookies()) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Whether to mark the session cookie Secure.
 *
 * Not keyed on NODE_ENV. Setting NODE_ENV=production on Railway would make
 * `npm install` skip devDependencies, and the build needs prisma, vite and
 * vue-tsc from there — so that variable cannot be set, and a Secure flag that
 * depends on it would never fire in the one place it matters. RAILWAY_ENVIRONMENT
 * is always present on a deployed service, and SECURE_COOKIES forces it anywhere
 * else that terminates TLS.
 */
export function secureCookies() {
  return process.env.SECURE_COOKIES === 'true'
    || process.env.NODE_ENV === 'production'
    || Boolean(process.env.RAILWAY_ENVIRONMENT);
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
 * Resolve a production and work out what this caller may do with it.
 *
 * A production nobody can reach, and one owned by somebody else, both answer 404
 * rather than 403. Saying "this exists but is not yours" confirms the id is
 * real, which is a fact worth nothing to the caller and something to an
 * attacker enumerating them.
 */
export async function loadAccessibleProduction(req, res, next, id) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
    const production = await prisma.production.findUnique({
      where: { id },
      include: { members: { where: { userId: req.user.id } } },
    });
    if (!production) return res.status(404).json({ error: 'Production not found.' });

    const role = production.ownerId === req.user.id
      ? 'owner'
      : production.members[0]?.role ?? null;
    if (!role) return res.status(404).json({ error: 'Production not found.' });

    req.production = production;
    req.productionRole = role;
    return next();
  } catch (error) {
    // A malformed uuid is a not-found, not a 500.
    if (error?.code === 'P2023' || /invalid input syntax/i.test(error?.message || '')) {
      return res.status(404).json({ error: 'Production not found.' });
    }
    return next(error);
  }
}

/** Apply the access check to every route on this router that names a production. */
export function scopeToOwner(router, ...paramNames) {
  for (const name of paramNames) router.param(name, loadAccessibleProduction);
  return router;
}

const RANK = { viewer: 1, editor: 2, owner: 3 };

/**
 * Gate a route on how much access the caller has.
 *
 * Reading is not the same as writing. A viewer can look at a schedule that has
 * been generated; generating one writes a forecast snapshot against the
 * production, so that needs `editor`. Changing who else can see a show is the
 * owner's alone.
 */
export function requireRole(minimum) {
  return (req, res, next) => {
    if (!req.productionRole) return res.status(404).json({ error: 'Production not found.' });
    if (RANK[req.productionRole] < RANK[minimum]) {
      return res.status(403).json({
        error: minimum === 'owner'
          ? 'Only the owner of this production can do that.'
          : 'You have read-only access to this production.',
      });
    }
    return next();
  };
}

/** Productions this user owns or has been given access to. */
export function visibleToUser(userId) {
  return { OR: [{ ownerId: userId }, { members: { some: { userId } } }] };
}

/**
 * Ownership check for a production named in the request body rather than the
 * path, where router.param never sees it. Writing needs editor or better.
 */
export async function canWriteToProduction(userId, productionId) {
  const production = await prisma.production.findUnique({
    where: { id: productionId },
    include: { members: { where: { userId } } },
  });
  if (!production) return false;
  if (production.ownerId === userId) return true;
  return production.members[0]?.role === 'editor';
}
