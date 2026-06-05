import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import xlsx from 'xlsx';
import { Router } from 'express';
import { prisma } from '../db.js';
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

function inferWeekBucketLabelFromSheetName(sheetName) {
  const value = String(sheetName || '').trim();
  const normalized = value.replace(/\s+/g, ' ');
  if (/PRESHOOT/i.test(normalized)) return 'Pre-Shoot';
  if (!/^\d{6}$/.test(normalized)) return 'Unknown';

  const month = Number.parseInt(normalized.slice(0, 2), 10);
  const day = Number.parseInt(normalized.slice(2, 4), 10);
  const year = Number.parseInt(`20${normalized.slice(4, 6)}`, 10);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const start = new Date(Date.UTC(2017, 9, 16));
  const diffDays = Math.floor((date.getTime() - start.getTime()) / 86400000);
  if (diffDays < 0) return 'Pre-Shoot';
  return `Shoot Week ${Math.floor(diffDays / 5) + 1}`;
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
      _sum: { actualDayCost: true },
      _count: { _all: true },
    });

    const daySummaries = await Promise.all(
      production.hotCostDays.map(async (day) => {
        const aggregates = await prisma.hotCostLineItem.aggregate({
          where: {
            productionId: production.id,
            hotCostDayId: day.id,
          },
          _sum: { actualDayCost: true },
          _count: { _all: true },
        });

        return {
          id: day.id,
          sheetName: day.sheetName,
          dayLabel: day.dayLabel,
          workDateLabel: day.workDateLabel,
          lineItemCount: day._count.lineItems,
          totalActualDayCost: aggregates._sum.actualDayCost,
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
      },
      daySummaries,
    });
  } catch (error) {
    return next(error);
  }
});

importsRouter.post('/sample', async (_req, res, next) => {
  try {
    const result = await importSampleCashflowWorkbook();
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
      };

      existing.rowCount += 1;
      existing.totalActualDayCost += Number(lineItem.actualDayCost || 0);
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

      const importedSectionTotal = section.lineItems.reduce(
        (sum, lineItem) => sum + Number(lineItem.importedTotal || 0),
        0,
      );

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
          orderBy: { createdAt: 'asc' },
          include: {
            lineItems: true,
          },
        },
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found.' });
    }

    const buckets = new Map();
    for (const day of production.hotCostDays) {
      const weekLabel = inferWeekBucketLabelFromSheetName(day.sheetName);
      const totalActual = day.lineItems.reduce((sum, lineItem) => sum + Number(lineItem.actualDayCost || 0), 0);
      const existing = buckets.get(weekLabel) || {
        weekLabel,
        dayCount: 0,
        rowCount: 0,
        totalActualDayCost: 0,
        days: [],
      };

      existing.dayCount += 1;
      existing.rowCount += day.lineItems.length;
      existing.totalActualDayCost += totalActual;
      existing.days.push({
        hotCostDayId: day.id,
        sheetName: day.sheetName,
        dayLabel: day.dayLabel,
        workDateLabel: day.workDateLabel,
        totalActualDayCost: totalActual,
      });

      buckets.set(weekLabel, existing);
    }

    const rows = Array.from(buckets.values()).sort((a, b) => a.weekLabel.localeCompare(b.weekLabel, undefined, { numeric: true }));

    return res.json({
      productionId: production.id,
      title: production.title,
      weeks: rows,
    });
  } catch (error) {
    return next(error);
  }
});

importsRouter.get('/hot-cost/:productionId/weekly-comparison', async (req, res, next) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.productionId },
      include: {
        hotCostDays: {
          orderBy: { createdAt: 'asc' },
          include: {
            lineItems: true,
          },
        },
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found.' });
    }

    const weeklyActuals = new Map();
    for (const day of production.hotCostDays) {
      const weekLabel = inferWeekBucketLabelFromSheetName(day.sheetName);
      const totalActual = day.lineItems.reduce((sum, lineItem) => sum + Number(lineItem.actualDayCost || 0), 0);
      weeklyActuals.set(weekLabel, (weeklyActuals.get(weekLabel) || 0) + totalActual);
    }

    const snapshot = production.snapshots[0] || null;
    const plannedRows = snapshot?.weeklyTotalsJson || [];

    const rows = plannedRows.map((period, index) => {
      const planned = Number(period.amount || 0);
      const actualLabel = index < 5
        ? 'Pre-Shoot'
        : index >= 7 && index <= 11
          ? `Shoot Week ${index - 6}`
          : null;
      const actual = actualLabel ? Number(weeklyActuals.get(actualLabel) || 0) : 0;

      return {
        periodLabel: period.label,
        periodSequence: period.periodSequence,
        matchedActualBucket: actualLabel,
        plannedAmount: planned,
        actualAmount: actual,
        delta: actual - planned,
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

    const workbook = xlsx.readFile(req.file.path, { cellFormula: true, cellDates: false });

    if (isHotCostWorkbook(workbook)) {
      const normalizedHotCost = normalizeHotCostWorkbook(req.file.path);
      const result = await persistNormalizedHotCostWorkbook(normalizedHotCost, {
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
      productionTitle: req.body.productionTitle || req.file.originalname.replace(/\.[^.]+$/, ''),
    });

    return res.json({ ok: true, workbookType: 'cash-flow', result });
  } catch (error) {
    return next(error);
  }
});
