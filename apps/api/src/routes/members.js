/**
 * Who else can see a production.
 *
 * A show is worked on by more than one person — a producer and a production
 * accountant are looking at the same budget for different reasons — so access
 * is per production rather than per account. Ownership is not a row here: it
 * lives on the production, so there is exactly one owner and no sequence of
 * removals can leave a show belonging to nobody.
 *
 * Sharing with someone who has no account yet issues an invitation carrying the
 * share, so "put my accountant on this show" is one action rather than an
 * invite now and a second visit after they sign up.
 */

import { Router } from 'express';
import { prisma } from '../db.js';
import { newToken } from '../auth/credentials.js';
import { requireRole } from '../auth/middleware.js';

// mergeParams so :id from the parent router is still visible here.
export const membersRouter = Router({ mergeParams: true });

const ROLES = ['editor', 'viewer'];
const INVITE_DAYS = 14;

function publicMember(member) {
  return {
    id: member.id,
    role: member.role,
    createdAt: member.createdAt,
    user: member.user
      ? { id: member.user.id, email: member.user.email, name: member.user.name }
      : null,
  };
}

/** Anyone on the show can see who else is on it. */
membersRouter.get('/', async (req, res, next) => {
  try {
    const [owner, members, pending] = await Promise.all([
      req.production.ownerId
        ? prisma.user.findUnique({ where: { id: req.production.ownerId } })
        : null,
      prisma.production.findUnique({ where: { id: req.production.id } })
        .members({ include: { user: true }, orderBy: { createdAt: 'asc' } }),
      prisma.invite.findMany({
        where: {
          productionId: req.production.id,
          acceptedAt: null,
          revokedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    res.json({
      yourRole: req.productionRole,
      owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : null,
      members: members.map(publicMember),
      pending: pending.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

membersRouter.post('/', requireRole('owner'), async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || 'viewer');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}.` });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      if (user.id === req.production.ownerId) {
        return res.status(409).json({ error: 'That person already owns this production.' });
      }
      const member = await prisma.productionMember.upsert({
        where: { productionId_userId: { productionId: req.production.id, userId: user.id } },
        update: { role },
        create: {
          productionId: req.production.id,
          userId: user.id,
          role,
          addedById: req.user.id,
        },
        include: { user: true },
      });
      return res.status(201).json({ member: publicMember(member), invited: false });
    }

    // No account yet: the invitation carries the share. Retire any earlier one
    // for the same person and show rather than leaving two live credentials.
    await prisma.invite.updateMany({
      where: {
        email, productionId: req.production.id, acceptedAt: null, revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    const { token, tokenHash } = newToken();
    const invite = await prisma.invite.create({
      data: {
        email,
        tokenHash,
        role,
        productionId: req.production.id,
        invitedById: req.user.id,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`)
      .replace(/\/$/, '');
    return res.status(201).json({
      invited: true,
      invite: { id: invite.id, email: invite.email, role: invite.role,
        expiresAt: invite.expiresAt },
      // Shown once — only the hash is stored.
      link: `${base}/?invite=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    return next(error);
  }
});

membersRouter.patch('/:memberId', requireRole('owner'), async (req, res, next) => {
  try {
    const role = String(req.body?.role || '');
    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}.` });
    }
    const member = await prisma.productionMember.findUnique({
      where: { id: req.params.memberId },
    });
    if (!member || member.productionId !== req.production.id) {
      return res.status(404).json({ error: 'Not on this production.' });
    }
    const updated = await prisma.productionMember.update({
      where: { id: member.id }, data: { role }, include: { user: true },
    });
    return res.json(publicMember(updated));
  } catch (error) {
    return next(error);
  }
});

/** The owner can remove anyone; anyone can remove themselves. */
membersRouter.delete('/:memberId', async (req, res, next) => {
  try {
    const member = await prisma.productionMember.findUnique({
      where: { id: req.params.memberId },
    });
    if (!member || member.productionId !== req.production.id) {
      return res.status(404).json({ error: 'Not on this production.' });
    }
    if (req.productionRole !== 'owner' && member.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Only the owner of this production can remove other people.',
      });
    }
    await prisma.productionMember.delete({ where: { id: member.id } });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

/** Withdraw a share that was sent to someone who never signed up. */
membersRouter.delete('/pending/:inviteId', requireRole('owner'), async (req, res, next) => {
  try {
    const invite = await prisma.invite.findUnique({ where: { id: req.params.inviteId } });
    if (!invite || invite.productionId !== req.production.id) {
      return res.status(404).json({ error: 'Invitation not found.' });
    }
    await prisma.invite.update({
      where: { id: invite.id },
      data: { revokedAt: invite.revokedAt ?? new Date() },
    });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});
