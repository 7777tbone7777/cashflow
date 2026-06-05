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
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found.' });
    }

    const batch = production.importBatches[0];
    return res.json({
      productionId: production.id,
      title: production.title,
      hotCostImport: batch?.metadataJson || null,
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

importsRouter.post('/upload', upload.single('workbook'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Workbook file is required.' });
    }

    const workbook = xlsx.readFile(req.file.path, { cellFormula: true, cellDates: false });

    if (isHotCostWorkbook(workbook)) {
      const normalizedHotCost = normalizeHotCostWorkbook(req.file.path);
      const production = await prisma.production.create({
        data: {
          title: req.body.productionTitle || req.file.originalname.replace(/\.[^.]+$/, ''),
          currency: 'USD',
          status: 'draft',
          notes: `Hot cost workbook uploaded: ${req.file.originalname}`,
        },
      });

      const importBatch = await prisma.importBatch.create({
        data: {
          productionId: production.id,
          sourceType: 'hotcost_xls',
          originalFilename: req.file.originalname,
          fileStorageKey: req.file.path,
          importStatus: 'completed',
          parserVersion: 'hot-cost-v1',
          metadataJson: {
            workbookType: normalizedHotCost.workbookType,
            summarySheetName: normalizedHotCost.summarySheetName,
            sheetNames: normalizedHotCost.sheetNames,
            daySheetNames: normalizedHotCost.daySheetNames,
            dayColumns: normalizedHotCost.dayColumns,
            summaryEntryCount: normalizedHotCost.summaryEntries.length,
            daySheetSummaries: normalizedHotCost.daySheetSummaries,
          },
        },
      });

      return res.json({
        ok: true,
        workbookType: 'hot-cost',
        result: {
          productionId: production.id,
          importBatchId: importBatch.id,
          productionTitle: production.title,
          daySheetCount: normalizedHotCost.daySheetNames.length,
          summaryEntryCount: normalizedHotCost.summaryEntries.length,
        },
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
