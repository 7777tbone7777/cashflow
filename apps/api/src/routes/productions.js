import { Router } from 'express';
import { prisma } from '../db.js';
import { requireRole, scopeToOwner, visibleToUser } from '../auth/middleware.js';
import { membersRouter } from './members.js';

export const productionsRouter = Router();

// Every route below that names a production is checked for ownership here, so
// adding one later cannot forget to do it.
scopeToOwner(productionsRouter, 'id');

productionsRouter.get('/', async (req, res, next) => {
  try {
    const productions = await prisma.production.findMany({
      // A picker full of pictures that wrapped two years ago is a worse picker.
      where: req.query.archived === 'true'
        ? visibleToUser(req.user.id)
        : { AND: [visibleToUser(req.user.id), { archivedAt: null }] },
      orderBy: { createdAt: 'asc' },
      include: {
        members: { where: { userId: req.user.id } },
        _count: {
          select: {
            periods: true,
            sections: true,
            lineItems: true,
            snapshots: true,
            importBatches: true,
          },
        },
      },
    });

    res.json(
      productions.map((production) => ({
        id: production.id,
        title: production.title,
        currency: production.currency,
        status: production.status,
        // The interface has to know whether to offer the buttons that write.
        role: production.ownerId === req.user.id
          ? 'owner'
          : production.members[0]?.role ?? 'viewer',
        archivedAt: production.archivedAt,
        counts: production._count,
        createdAt: production.createdAt,
        updatedAt: production.updatedAt,
      }))
    );
  } catch (error) {
    next(error);
  }
});

productionsRouter.get('/:id', async (req, res, next) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.id },
      include: {
        importBatches: {
          orderBy: { createdAt: 'desc' },
        },
        snapshots: {
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            periods: true,
            sections: true,
            lineItems: true,
          },
        },
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found' });
    }

    return res.json({
      id: production.id,
      title: production.title,
      currency: production.currency,
      status: production.status,
      notes: production.notes,
      archivedAt: production.archivedAt,
      role: req.productionRole,
      counts: production._count,
      latestImport: production.importBatches[0] || null,
      latestSnapshot: production.snapshots[0] || null,
    });
  } catch (error) {
    return next(error);
  }
});

productionsRouter.get('/:id/periods', async (req, res, next) => {
  try {
    const periods = await prisma.cashFlowPeriod.findMany({
      where: { productionId: req.params.id },
      orderBy: { sequence: 'asc' },
    });

    res.json(periods);
  } catch (error) {
    next(error);
  }
});

productionsRouter.get('/:id/sections', async (req, res, next) => {
  try {
    const sections = await prisma.cashFlowSection.findMany({
      where: { productionId: req.params.id },
      orderBy: { displayOrder: 'asc' },
      include: {
        _count: {
          select: {
            lineItems: true,
          },
        },
      },
    });

    res.json(
      sections.map((section) => ({
        id: section.id,
        code: section.code,
        name: section.name,
        displayOrder: section.displayOrder,
        sourceStartRow: section.sourceStartRow,
        sourceEndRow: section.sourceEndRow,
        lineItemCount: section._count.lineItems,
      }))
    );
  } catch (error) {
    next(error);
  }
});

productionsRouter.get('/:id/sections/:sectionId/line-items', async (req, res, next) => {
  try {
    const lineItems = await prisma.cashFlowLineItem.findMany({
      where: {
        productionId: req.params.id,
        sectionId: req.params.sectionId,
      },
      orderBy: { sourceRowNumber: 'asc' },
      include: {
        allocations: {
          include: {
            period: true,
          },
          orderBy: {
            period: {
              sequence: 'asc',
            },
          },
        },
      },
    });

    res.json(
      lineItems.map((lineItem) => ({
        id: lineItem.id,
        accountCode: lineItem.accountCode,
        description: lineItem.description,
        lineType: lineItem.lineType,
        sourceRowNumber: lineItem.sourceRowNumber,
        ctdAmount: lineItem.ctdAmount,
        commitmentsAmount: lineItem.commitmentsAmount,
        importedTotal: lineItem.importedTotal,
        allocations: lineItem.allocations.map((allocation) => ({
          id: allocation.id,
          amount: allocation.amount,
          periodSequence: allocation.period.sequence,
          periodLabel: allocation.period.label,
        })),
      }))
    );
  } catch (error) {
    next(error);
  }
});

productionsRouter.get('/:id/summary', async (req, res, next) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.id },
      include: {
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found' });
    }

    const snapshot = production.snapshots[0] || null;

    return res.json({
      production: {
        id: production.id,
        title: production.title,
        currency: production.currency,
        status: production.status,
        role: req.productionRole,
      },
      snapshot: snapshot
        ? {
            id: snapshot.id,
            name: snapshot.name,
            totalCtd: snapshot.totalCtd,
            totalCommitments: snapshot.totalCommitments,
            weeklyTotals: snapshot.weeklyTotalsJson,
            cumulativeTotals: snapshot.cumulativeTotalsJson,
            createdAt: snapshot.createdAt,
          }
        : null,
    });
  } catch (error) {
    return next(error);
  }
});

// Who else can see this show.
productionsRouter.use('/:id/members', membersRouter);

/**
 * Archive and restore.
 *
 * Reversible, and it hides the show from everyone who can see it rather than
 * only from the person who pressed it — a wrapped picture is finished for the
 * whole team, not just its owner.
 */
productionsRouter.post('/:id/archive', requireRole('owner'), async (req, res, next) => {
  try {
    const production = await prisma.production.update({
      where: { id: req.params.id },
      data: { archivedAt: req.production.archivedAt ?? new Date() },
    });
    return res.json({ id: production.id, archivedAt: production.archivedAt });
  } catch (error) {
    return next(error);
  }
});

productionsRouter.post('/:id/unarchive', requireRole('owner'), async (req, res, next) => {
  try {
    const production = await prisma.production.update({
      where: { id: req.params.id },
      data: { archivedAt: null },
    });
    return res.json({ id: production.id, archivedAt: null });
  } catch (error) {
    return next(error);
  }
});

/**
 * Destroy a production and everything under it.
 *
 * Irreversible, and it takes the budget, the periods, the line items, the
 * allocations, the snapshots and the hot cost days with it. The caller has to
 * name the show to prove they meant this one — an id in a URL is too easy to
 * get wrong, and there is no undo behind this.
 */
productionsRouter.delete('/:id', requireRole('owner'), async (req, res, next) => {
  try {
    const confirm = String(req.body?.confirmTitle || '').trim();
    if (confirm !== req.production.title) {
      return res.status(400).json({
        error: 'Type the production title exactly to confirm deletion.',
        expected: req.production.title,
      });
    }
    await prisma.production.delete({ where: { id: req.params.id } });
    return res.json({ ok: true, deleted: req.production.title });
  } catch (error) {
    return next(error);
  }
});

/**
 * Hand a show to somebody else.
 *
 * The outgoing owner stays on as an editor rather than losing the show
 * outright, because the common case is a producer handing a picture to the
 * accountant who now runs it, not walking away from it. They can remove
 * themselves afterwards; the new owner can remove them too.
 */
productionsRouter.post('/:id/transfer', requireRole('owner'), async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const target = await prisma.user.findUnique({ where: { email } });
    if (!target) {
      return res.status(404).json({
        error: 'No account for that address. Add them to the show first — that '
          + 'sends an invitation — and transfer once they have signed up.',
      });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You already own this production.' });
    }

    const production = await prisma.$transaction(async (tx) => {
      // The owner is not a membership row, so the incoming owner's is retired
      // and the outgoing one gains theirs.
      await tx.productionMember.deleteMany({
        where: { productionId: req.params.id, userId: target.id },
      });
      await tx.productionMember.upsert({
        where: {
          productionId_userId: { productionId: req.params.id, userId: req.user.id },
        },
        update: { role: 'editor' },
        create: {
          productionId: req.params.id,
          userId: req.user.id,
          role: 'editor',
          addedById: target.id,
        },
      });
      return tx.production.update({
        where: { id: req.params.id },
        data: { ownerId: target.id },
      });
    });

    return res.json({
      ok: true,
      owner: { id: target.id, email: target.email, name: target.name },
      yourRoleNow: 'editor',
      productionId: production.id,
    });
  } catch (error) {
    return next(error);
  }
});
