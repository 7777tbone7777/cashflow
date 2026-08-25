import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import xlsx from 'xlsx';
import { Router } from 'express';
import { prisma } from '../db.js';
import { scopeToOwner } from '../auth/middleware.js';
import { importSampleCashflowWorkbook } from '../services/importers/importSampleCashflowWorkbook.js';
import { normalizeCashflowWorkbook } from '../services/importers/normalizeCashflowWorkbook.js';
import { persistNormalizedCashflow } from '../services/importers/persistNormalizedCashflow.js';
import { isHotCostWorkbook, normalizeHotCostWorkbook } from '../services/importers/normalizeHotCostWorkbook.js';
import { persistNormalizedHotCostWorkbook } from '../services/importers/persistNormalizedHotCostWorkbook.js';

const uploadDir = path.resolve('apps/api/uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const safeBase = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${safeBase}${ext}`);
  },
});

const upload = multer({ storage });

export const importsRouter = Router();

scopeToOwner(importsRouter, 'productionId');

function mapAccountCodeToCashflowBucket(accountCode) {
  if (!accountCode) return 'unmapped';

  const department = Number.parseInt(String(accountCode).split('-')[0], 10);
  if (Number.isNaN(department)) return 'unmapped';

  if (department >= 1400 && department < 2000) return 'cast';
  if (department >= 2000 && department < 2200) return 'production_staff';
  if (department >= 2200 && department < 2500) return 'art_department';
  if (department >= 2500 && department < 2600) return 'set_operations';
  if (department >= 2600 && department < 2700) return 'special_effects';
  if (department >= 2700 && department < 2900) return 'set_dressing_property';
  if (department >= 2900 && department < 3000) return 'wardrobe';
  if (department >= 3000 && department < 3200) return 'vehicles_makeup';
  if (department >= 3200 && department < 3300) return 'lighting';
  if (department >= 3300 && department < 3400) return 'camera';
  if (department >= 3400 && department < 3500) return 'sound';
  if (department >= 3500 && department < 3700) return 'transport_locations';
  if (department >= 3700 && department < 5000) return 'facilities_film';
  return 'other';
}

const bucketLabels = {
  cast: 'Cast',
  production_staff: 'Production Staff',
  art_department: 'Art Department',
  set_operations: 'Set Operations',
  special_effects: 'Special Effects',
  set_dressing_property: 'Set Dressing / Property',
  wardrobe: 'Wardrobe',
  vehicles_makeup: 'Vehicles / Makeup',
  lighting: 'Lighting',
  camera: 'Camera',
  sound: 'Sound',
  transport_locations: 'Transport / Locations',
  facilities_film: 'Facilities / Film',
  other: 'Other',
  unmapped: 'Unmapped',
};

function normalizeSectionName(sectionName) {
  return String(sectionName || '').trim().toUpperCase();
}

// Group days into weeks by the date each sheet states in D2, matched against
// the cash flow's own week-ending dates. The previous version parsed the sheet
// name and counted forward from a hardcoded 2017-10-16 shoot start, which is
// wrong for every other production.
function weekEndingFor(day, periods) {
  const workDate = day.workDate ? new Date(day.workDate) : null;
  if (!workDate || Number.isNaN(workDate.getTime())) return null;
  const dated = periods.filter((period) => period.weekEndingDate);
  for (const period of dated) {
    const ends = new Date(period.weekEndingDate);
    const starts = new Date(ends.getTime() - 6 * 86400000);
    if (workDate >= starts && workDate <= ends) return period;
  }
  return null;
}

function mapBucketToCashflowSectionNames(bucketKey) {
  const mapping = {
    cast: ['CAST'],
    production_staff: ['PRODUCTION STAFF', 'EXTRA TALENT'],
    art_department: ['ART DEPARTMENT', 'CONSTRUCTION'],
    set_operations: ['SET OPERATIONS'],
    special_effects: ['SPECIAL EFFECTS'],
    set_dressing_property: ['SET DRESSING', 'PROPERTY'],
    wardrobe: ['WARDROBE'],
    vehicles_makeup: ['PICTURE VEHICLES & ANIMALS', 'MAKEUP & HAIR'],
    lighting: ['SET LIGHTING'],
    camera: ['CAMERA'],
    sound: ['PRODUCTION SOUND'],
    transport_locations: ['TRANSPORTATION', 'LOCATIONS'],
    facilities_film: ['PRODUCTION FILM & LAB', 'STAGE RENTALS & FACILITIES', 'TESTS'],
    other: ['INSURANCE', 'GENERAL EXPENSE'],
    unmapped: [],
  };

  return mapping[bucketKey] || [];
}

importsRouter.get('/status', (_req, res) => {
  res.json({
    ok: true,
    importer: 'cashflow-xlsx',
    status: 'scaffolded'
  });
});

importsRouter.get('/hot-cost/:productionId', async (req, res, next) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.productionId },
      include: {
        importBatches: {
          where: { sourceType: 'hotcost_xls' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        hotCostDays: {
          orderBy: { createdAt: 'asc' },
          include: {
            _count: {
              select: { lineItems: true },
            },
          },
        },
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found.' });
    }

    const batch = production.importBatches[0];
    const persistedDays = production.hotCostDays.map((day) => ({
      id: day.id,
      sheetName: day.sheetName,
      dayLabel: day.dayLabel,
      workDateLabel: day.workDateLabel,
      lineItemCount: day._count.lineItems,
    }));

    const aggregate = await prisma.hotCostLineItem.aggregate({
      where: { productionId: production.id },
      _sum: { actualDayCost: true, budgetDayCost: true, dayVariance: true },
      _count: { _all: true },
    });

    const daySummaries = await Promise.all(
      production.hotCostDays.map(async (day) => {
        const aggregates = await prisma.hotCostLineItem.aggregate({
          where: {
            productionId: production.id,
            hotCostDayId: day.id,
          },
          _sum: { actualDayCost: true, budgetDayCost: true, dayVariance: true },
          _count: { _all: true },
        });

        return {
          id: day.id,
          sheetName: day.sheetName,
          workDate: day.workDate,
          dayLabel: day.dayLabel,
          workDateLabel: day.workDateLabel,
          lineItemCount: day._count.lineItems,
          totalActualDayCost: aggregates._sum.actualDayCost,
          totalBudgetDayCost: aggregates._sum.budgetDayCost,
          totalDayVariance: aggregates._sum.dayVariance,
          nonEmptyRowCount: aggregates._count._all,
        };
      }),
    );

    return res.json({
      productionId: production.id,
      title: production.title,
      hotCostImport: batch?.metadataJson || null,
      persistedDays,
      summary: {
        totalDays: production.hotCostDays.length,
        totalRows: aggregate._count._all,
        totalActualDayCost: aggregate._sum.actualDayCost,
        totalBudgetDayCost: aggregate._sum.budgetDayCost,
        totalDayVariance: aggregate._sum.dayVariance,
      },
      daySummaries,
    });
  } catch (error) {
    return next(error);
  }
});

importsRouter.post('/sample', async (req, res, next) => {
  try {
    const result = await importSampleCashflowWorkbook({ ownerId: req.user.id });
    res.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

importsRouter.get('/hot-cost/:productionId/mapping-summary', async (req, res, next) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.productionId },
      select: { id: true, title: true },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found.' });
    }

    const lineItems = await prisma.hotCostLineItem.findMany({
      where: { productionId: req.params.productionId },
      select: {
        accountCode: true,
        actualDayCost: true,
        budgetDayCost: true,
        dayVariance: true,
      },
    });

    const buckets = new Map();
    for (const lineItem of lineItems) {
      const bucketKey = mapAccountCodeToCashflowBucket(lineItem.accountCode);
      const existing = buckets.get(bucketKey) || {
        bucketKey,
        label: bucketLabels[bucketKey] || bucketKey,
        rowCount: 0,
        totalActualDayCost: 0,
        totalBudgetDayCost: 0,
        totalDayVariance: 0,
      };

      existing.rowCount += 1;
      existing.totalActualDayCost += Number(lineItem.actualDayCost || 0);
      existing.totalBudgetDayCost += Number(lineItem.budgetDayCost || 0);
      existing.totalDayVariance += Number(lineItem.dayVariance || 0);
      buckets.set(bucketKey, existing);
    }

    const rows = Array.from(buckets.values()).sort((a, b) => Math.abs(b.totalActualDayCost) - Math.abs(a.totalActualDayCost));

    return res.json({
      productionId: production.id,
      title: production.title,
      buckets: rows,
      totals: {
        rowCount: rows.reduce((sum, row) => sum + row.rowCount, 0),
        totalActualDayCost: rows.reduce((sum, row) => sum + row.totalActualDayCost, 0),
        totalBudgetDayCost: rows.reduce((sum, row) => sum + row.totalBudgetDayCost, 0),
        totalDayVariance: rows.reduce((sum, row) => sum + row.totalDayVariance, 0),
      },
    });
  } catch (error) {
    return next(error);
  }
});

importsRouter.get('/hot-cost/:productionId/section-comparison', async (req, res, next) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.productionId },
      include: {
        sections: {
          orderBy: { displayOrder: 'asc' },
          include: {
            lineItems: true,
          },
        },
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found.' });
    }

    const hotCostLineItems = await prisma.hotCostLineItem.findMany({
      where: { productionId: req.params.productionId },
      select: { accountCode: true, actualDayCost: true },
    });

    const bucketTotals = new Map();
    for (const lineItem of hotCostLineItems) {
      const bucketKey = mapAccountCodeToCashflowBucket(lineItem.accountCode);
      bucketTotals.set(bucketKey, (bucketTotals.get(bucketKey) || 0) + Number(lineItem.actualDayCost || 0));
    }

    const rows = production.sections.map((section) => {
      const normalizedName = normalizeSectionName(section.name);
      const matchingBucketEntry = Array.from(bucketTotals.entries()).find(([bucketKey]) =>
        mapBucketToCashflowSectionNames(bucketKey).includes(normalizedName),
      );

      // Detail and fringe rows only. A section also contains a subtotal row
      // that already sums them, so counting every line type returned exactly
      // twice the department's real cost — $12,124,003 against a budget of
      // $6,062,000.
      const importedSectionTotal = section.lineItems
        .filter((lineItem) => lineItem.lineType === 'detail' || lineItem.lineType === 'fringe')
        .reduce((sum, lineItem) => sum + Number(lineItem.importedTotal || 0), 0);

      return {
        sectionId: section.id,
        sectionName: section.name,
        sectionCode: section.code,
        mappedBucketKey: matchingBucketEntry?.[0] || null,
        mappedBucketLabel: matchingBucketEntry ? bucketLabels[matchingBucketEntry[0]] : null,
        hotCostActualTotal: matchingBucketEntry?.[1] || 0,
        importedCashflowTotal: importedSectionTotal,
        delta: (matchingBucketEntry?.[1] || 0) - importedSectionTotal,
      };
    });

    return res.json({
      productionId: production.id,
      title: production.title,
      rows,
    });
  } catch (error) {
    return next(error);
  }
});

importsRouter.get('/hot-cost/:productionId/weekly-rollup', async (req, res, next) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.productionId },
      include: {
        hotCostDays: {
          orderBy: { workDate: 'asc' },
          include: {
            lineItems: true,
          },
        },
        periods: { orderBy: { sequence: 'asc' } },
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found.' });
    }

    const buckets = new Map();
    for (const day of production.hotCostDays) {
      const period = weekEndingFor(day, production.periods);
      const weekLabel = period ? period.label : 'Unmatched';
      const sequence = period ? period.sequence : 9999;
      const totals = day.lineItems.reduce((acc, lineItem) => ({
        actual: acc.actual + Number(lineItem.actualDayCost || 0),
        budget: acc.budget + Number(lineItem.budgetDayCost || 0),
        variance: acc.variance + Number(lineItem.dayVariance || 0),
      }), { actual: 0, budget: 0, variance: 0 });

      const existing = buckets.get(weekLabel) || {
        weekLabel,
        sequence,
        weekEndingDate: period ? period.weekEndingDate : null,
        dayCount: 0,
        rowCount: 0,
        totalActualDayCost: 0,
        totalBudgetDayCost: 0,
        totalDayVariance: 0,
        days: [],
      };

      existing.dayCount += 1;
      existing.rowCount += day.lineItems.length;
      existing.totalActualDayCost += totals.actual;
      existing.totalBudgetDayCost += totals.budget;
      existing.totalDayVariance += totals.variance;
      existing.days.push({
        hotCostDayId: day.id,
        sheetName: day.sheetName,
        workDate: day.workDate,
        dayLabel: day.dayLabel,
        totalActualDayCost: totals.actual,
        totalBudgetDayCost: totals.budget,
        totalDayVariance: totals.variance,
      });

      buckets.set(weekLabel, existing);
    }

    const rows = Array.from(buckets.values()).sort((a, b) => a.sequence - b.sequence);

    return res.json({
      productionId: production.id,
      title: production.title,
      weeks: rows,
    });
  } catch (error) {
    return next(error);
  }
});

// The weekly actual-vs-planned endpoint was removed rather than repaired.
//
// It compared a week of hot cost against a week of the cash flow, but a hot
// cost covers variable labour only — measured against this production it is
// 19% of the cash flow planned for the same weeks. Even reading the correct
// column it would report a healthy show as catastrophically under-spending
// every week. The comparison is not fixable at this level of aggregation; the
// right home for hot cost actuals is pressure on a department's estimate to
// complete, which needs a cost report the app does not have yet.
//
// It also depended on a hardcoded 2017-10-16 shoot start and fixed period
// windows that assigned five pre-prep weeks the same actuals figure.

importsRouter.get('/hot-cost/:productionId/days/:dayId/line-items', async (req, res, next) => {
  try {
    const lineItems = await prisma.hotCostLineItem.findMany({
      where: {
        productionId: req.params.productionId,
        hotCostDayId: req.params.dayId,
      },
      orderBy: { sourceRowNumber: 'asc' },
      take: 200,
    });

    return res.json(
      lineItems.map((lineItem) => ({
        id: lineItem.id,
        accountCode: lineItem.accountCode,
        employeeName: lineItem.employeeName,
        position: lineItem.position,
        unionCode: lineItem.unionCode,
        rate: lineItem.rate,
        actualDayCost: lineItem.actualDayCost,
        budgetDayCost: lineItem.budgetDayCost,
        dayVariance: lineItem.dayVariance,
        sourceRowNumber: lineItem.sourceRowNumber,
      })),
    );
  } catch (error) {
    return next(error);
  }
});

importsRouter.post('/upload', upload.single('workbook'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Workbook file is required.' });
    }

    // productionId arrives in the body here, so router.param never sees it.
    if (req.body.productionId) {
      const existing = await prisma.production.findUnique({
        where: { id: req.body.productionId },
      });
      if (!existing || existing.ownerId !== req.user.id) {
        return res.status(404).json({ error: 'Production not found.' });
      }
    }

    const workbook = xlsx.readFile(req.file.path, { cellFormula: true, cellDates: false });

    if (isHotCostWorkbook(workbook)) {
      const normalizedHotCost = normalizeHotCostWorkbook(req.file.path);
      const result = await persistNormalizedHotCostWorkbook(normalizedHotCost, {
        ownerId: req.user.id,
        productionId: req.body.productionId || undefined,
        productionTitle: req.body.productionTitle || req.file.originalname.replace(/\.[^.]+$/, ''),
      });

      return res.json({
        ok: true,
        workbookType: 'hot-cost',
        result,
      });
    }

    const normalized = normalizeCashflowWorkbook(req.file.path);
    const result = await persistNormalizedCashflow(normalized, {
      ownerId: req.user.id,
      productionTitle: req.body.productionTitle || req.file.originalname.replace(/\.[^.]+$/, ''),
    });

    return res.json({ ok: true, workbookType: 'cash-flow', result });
  } catch (error) {
    return next(error);
  }
});
