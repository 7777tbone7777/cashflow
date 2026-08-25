/**
 * Sign in, sign out, and accept an invitation.
 *
 * There is no open sign-up. The first account is the exception — somebody has
 * to exist before anybody can be invited — and after that an account can only
 * be created by redeeming a one-time invite.
 */

import { Router } from 'express';
import { prisma } from '../db.js';
import { hashPassword, hashToken, newToken, verifyPassword } from '../auth/credentials.js';
import { SESSION_DAYS, requireAuth, sessionCookie } from '../auth/middleware.js';

export const authRouter = Router();

const MIN_PASSWORD = 10;

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

async function startSession(res, user, req) {
  const { token, tokenHash } = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 255) || null,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  res.setHeader('Set-Cookie', sessionCookie(token));
}

const normaliseEmail = (value) => String(value || '').trim().toLowerCase();

/** Whether this instance has anybody yet — the UI shows a different first screen. */
authRouter.get('/state', async (_req, res, next) => {
  try {
    const users = await prisma.user.count();
    res.json({ needsFirstUser: users === 0 });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const user = await prisma.user.findUnique({ where: { email } });
    // One message for both failures. Telling an unknown address apart from a
    // wrong password hands over a list of who has an account here.
    const ok = user && await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'That email and password do not match.' });
    await startSession(res, user, req);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    if (req.session) await prisma.session.delete({ where: { id: req.session.id } }).catch(() => {});
    res.setHeader('Set-Cookie', sessionCookie('', { clear: true }));
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

/** Sign out everywhere — the reason sessions are rows and not signed tokens. */
authRouter.post('/logout-all', requireAuth, async (req, res, next) => {
  try {
    await prisma.session.deleteMany({ where: { userId: req.user.id } });
    res.setHeader('Set-Cookie', sessionCookie('', { clear: true }));
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

/**
 * Create an account: the first one, or one redeeming an invitation.
 */
authRouter.post('/register', async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim() || null;
    const token = String(req.body?.inviteToken || '').trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({
        error: `Use at least ${MIN_PASSWORD} characters for the password.`,
      });
    }

    const userCount = await prisma.user.count();
    let invite = null;
    if (userCount > 0) {
      if (!token) {
        return res.status(403).json({
          error: 'This app is invitation only. Ask an existing user for an invite link.',
        });
      }
      invite = await prisma.invite.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) {
        return res.status(403).json({ error: 'That invitation is not valid any more.' });
      }
      // The invite names the address. Redeeming it for another one would let a
      // single link become an open door.
      if (invite.email !== email) {
        return res.status(403).json({
          error: `That invitation was issued to ${invite.email}.`,
        });
      }
    }

    if (await prisma.user.findUnique({ where: { email } })) {
      return res.status(409).json({ error: 'An account already exists for that address.' });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { email, name, passwordHash } });
      if (invite) {
        await tx.invite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
        // An invitation can carry a share, so somebody put on a show before they
        // had an account arrives already able to see it.
        if (invite.productionId) {
          await tx.productionMember.upsert({
            where: {
              productionId_userId: {
                productionId: invite.productionId, userId: created.id,
              },
            },
            update: { role: invite.role ?? 'viewer' },
            create: {
              productionId: invite.productionId,
              userId: created.id,
              role: invite.role ?? 'viewer',
              addedById: invite.invitedById,
            },
          });
        }
      }
      // Any other outstanding share sent to this address before they signed up.
      const carried = await tx.invite.findMany({
        where: {
          email, acceptedAt: null, revokedAt: null,
          productionId: { not: null }, expiresAt: { gt: new Date() },
          ...(invite ? { id: { not: invite.id } } : {}),
        },
      });
      for (const pending of carried) {
        await tx.productionMember.upsert({
          where: {
            productionId_userId: {
              productionId: pending.productionId, userId: created.id,
            },
          },
          update: { role: pending.role ?? 'viewer' },
          create: {
            productionId: pending.productionId,
            userId: created.id,
            role: pending.role ?? 'viewer',
            addedById: pending.invitedById,
          },
        });
        await tx.invite.update({
          where: { id: pending.id }, data: { acceptedAt: new Date() },
        });
      }
      return created;
    });

    await startSession(res, user, req);
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

/**
 * Change the password.
 *
 * Every other session is ended by doing so. A password is usually changed
 * because somebody thinks it is known, and leaving the sessions it created
 * alive would make the change cosmetic — this is the one thing sessions being
 * rows rather than signed tokens actually buys. The session making the request
 * is replaced rather than kept, so the browser doing the changing stays signed
 * in on a credential the old password never saw.
 */
authRouter.post('/password', requireAuth, async (req, res, next) => {
  try {
    const current = String(req.body?.currentPassword || '');
    const next_ = String(req.body?.newPassword || '');

    if (!await verifyPassword(current, req.user.passwordHash)) {
      return res.status(401).json({ error: 'That is not your current password.' });
    }
    if (next_.length < MIN_PASSWORD) {
      return res.status(400).json({
        error: `Use at least ${MIN_PASSWORD} characters for the new password.`,
      });
    }
    if (next_ === current) {
      return res.status(400).json({ error: 'That is the password you already have.' });
    }

    const passwordHash = await hashPassword(next_);
    await prisma.$transaction([
      prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } }),
      prisma.session.deleteMany({ where: { userId: req.user.id } }),
    ]);
    await startSession(res, req.user, req);

    return res.json({ ok: true, otherSessionsEnded: true });
  } catch (error) {
    return next(error);
  }
});

/**
 * What stands between this account and deletion.
 *
 * Owned productions do, and that is the whole point: a show that has been shared
 * with a producer and an accountant should not vanish because the person who
 * first uploaded the budget closed their account.
 */
authRouter.get('/account/blockers', requireAuth, async (req, res, next) => {
  try {
    const owned = await prisma.production.findMany({
      where: { ownerId: req.user.id },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { members: true } } },
    });
    res.json({
      canDelete: owned.length === 0,
      owned: owned.map((production) => ({
        id: production.id,
        title: production.title,
        archivedAt: production.archivedAt,
        sharedWith: production._count.members,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Close this account.
 *
 * Refused while it still owns a production. Transfer each one to whoever is
 * carrying it on, or delete it outright, and then this will go through. The
 * database enforces the same rule independently, so a route added later that
 * forgets to check cannot destroy somebody else's show either.
 *
 * Shows shared *with* this account are not affected — the membership goes, the
 * production stays with its owner.
 */
authRouter.delete('/account', requireAuth, async (req, res, next) => {
  try {
    const password = String(req.body?.password || '');
    if (!await verifyPassword(password, req.user.passwordHash)) {
      return res.status(401).json({ error: 'That password is not right.' });
    }

    const owned = await prisma.production.findMany({
      where: { ownerId: req.user.id },
      orderBy: { createdAt: 'asc' },
    });
    if (owned.length) {
      return res.status(409).json({
        error: `This account still owns ${owned.length} `
          + `production${owned.length === 1 ? '' : 's'}. Transfer `
          + `${owned.length === 1 ? 'it' : 'each of them'} to somebody else, or delete `
          + `${owned.length === 1 ? 'it' : 'them'}, before closing the account.`,
        owned: owned.map((p) => ({ id: p.id, title: p.title })),
      });
    }

    await prisma.user.delete({ where: { id: req.user.id } });
    res.setHeader('Set-Cookie', sessionCookie('', { clear: true }));
    return res.json({ ok: true });
  } catch (error) {
    // The database says no as well, and its answer is the authoritative one.
    if (error?.code === 'P2003' || error?.code === 'P2014') {
      return res.status(409).json({
        error: 'This account still owns productions. Transfer or delete them first.',
      });
    }
    return next(error);
  }
});
