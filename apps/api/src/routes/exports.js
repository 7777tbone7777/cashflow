import { Router } from 'express';
import { prisma } from '../db.js';
import { scopeToOwner } from '../auth/middleware.js';

export const exportsRouter = Router();

scopeToOwner(exportsRouter, 'id');

exportsRouter.get('/productions/:id/report.json', async (req, res, next) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.id },
      include: {
        periods: { orderBy: { sequence: 'asc' } },
        sections: {
          orderBy: { displayOrder: 'asc' },
          include: {
            lineItems: {
              orderBy: { sourceRowNumber: 'asc' },
              include: {
                allocations: {
                  include: { period: true },
                  orderBy: { period: { sequence: 'asc' } },
                },
              },
            },
          },
        },
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found' });
    }

    return res.json({
      production: {
        id: production.id,
        title: production.title,
        currency: production.currency,
        status: production.status,
      },
      periods: production.periods,
      latestSnapshot: production.snapshots[0] || null,
      sections: production.sections.map((section) => ({
        id: section.id,
        name: section.name,
        code: section.code,
        lineItems: section.lineItems.map((lineItem) => ({
          id: lineItem.id,
          accountCode: lineItem.accountCode,
          description: lineItem.description,
          lineType: lineItem.lineType,
          importedTotal: lineItem.importedTotal,
          allocations: lineItem.allocations.map((allocation) => ({
            periodLabel: allocation.period.label,
            amount: allocation.amount,
          })),
        })),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

exportsRouter.get('/productions/:id/report.csv', async (req, res, next) => {
  try {
    const lineItems = await prisma.cashFlowLineItem.findMany({
      where: { productionId: req.params.id },
      orderBy: { sourceRowNumber: 'asc' },
      include: {
        section: true,
        allocations: {
          include: { period: true },
          orderBy: { period: { sequence: 'asc' } },
        },
      },
    });

    const csvRows = [
      ['section', 'account_code', 'description', 'line_type', 'source_row', 'imported_total', 'allocations'].join(','),
      ...lineItems.map((lineItem) => {
        const allocationText = lineItem.allocations
          .map((allocation) => `${allocation.period.label}:${allocation.amount}`)
          .join(' | ')
          .replace(/,/g, ';');

        return [
          JSON.stringify(lineItem.section?.name || ''),
          JSON.stringify(lineItem.accountCode || ''),
          JSON.stringify(lineItem.description || ''),
          JSON.stringify(lineItem.lineType || ''),
          JSON.stringify(lineItem.sourceRowNumber || ''),
          JSON.stringify(lineItem.importedTotal || ''),
          JSON.stringify(allocationText),
        ].join(',');
      }),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="production-${req.params.id}-report.csv"`);
    return res.send(csvRows.join('\n'));
  } catch (error) {
    return next(error);
  }
});
