/**
 * Invitations.
 *
 * An invite grants access to the application, not to the inviter's work. Two
 * people invited by the same person still cannot see each other's productions —
 * there is no sharing model here yet, and pretending otherwise would be worse
 * than saying so.
 *
 * The link is emailed when mail is configured, and returned either way — a
 * delivery that silently failed is worse than one you were handed and can send
 * yourself. The response says which happened.
 */

import { Router } from 'express';
import { prisma } from '../db.js';
import { newToken } from '../auth/credentials.js';
import { requireAuth } from '../auth/middleware.js';
import { inviteEmail, sendEmail } from '../email.js';

export const invitesRouter = Router();

const INVITE_DAYS = 14;

invitesRouter.use(requireAuth);

function inviteLink(req, token) {
  const configured = process.env.APP_URL;
  const base = configured || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/?invite=${encodeURIComponent(token)}`;
}

function publicInvite(invite) {
  return {
    id: invite.id,
    email: invite.email,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    revokedAt: invite.revokedAt,
    status: invite.acceptedAt ? 'accepted'
      : invite.revokedAt ? 'revoked'
        : invite.expiresAt < new Date() ? 'expired' : 'pending',
  };
}

invitesRouter.get('/', async (req, res, next) => {
  try {
    const invites = await prisma.invite.findMany({
      where: { invitedById: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(invites.map(publicInvite));
  } catch (error) {
    next(error);
  }
});

invitesRouter.post('/', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      return res.status(409).json({ error: 'That address already has an account.' });
    }

    // Re-inviting is a normal thing to do when a link is lost. Retire the old
    // one rather than leaving two live credentials for the same address.
    await prisma.invite.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const { token, tokenHash } = newToken();
    const invite = await prisma.invite.create({
      data: {
        email,
        tokenHash,
        invitedById: req.user.id,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    const link = inviteLink(req, token);
    const delivery = await sendEmail({
      to: email,
      ...inviteEmail({ link, invitedBy: req.user, expiresAt: invite.expiresAt }),
    });

    return res.status(201).json({
      invite: publicInvite(invite),
      // Shown once and never recoverable — only the hash is kept.
      link,
      emailed: delivery.sent,
      emailError: delivery.sent ? null : delivery.reason,
    });
  } catch (error) {
    return next(error);
  }
});

invitesRouter.post('/:id/revoke', async (req, res, next) => {
  try {
    const invite = await prisma.invite.findUnique({ where: { id: req.params.id } });
    if (!invite || invite.invitedById !== req.user.id) {
      return res.status(404).json({ error: 'Invite not found.' });
    }
    const updated = await prisma.invite.update({
      where: { id: invite.id },
      data: { revokedAt: invite.acceptedAt ? invite.revokedAt : new Date() },
    });
    return res.json(publicInvite(updated));
  } catch (error) {
    return next(error);
  }
});
