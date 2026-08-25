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
      where: visibleToUser(req.user.id),
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
