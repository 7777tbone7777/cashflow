import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import xlsx from 'xlsx';
import { Router } from 'express';
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
      return res.status(501).json({
        error: 'Hot cost workbook import is recognized but full cash flow generation from hot cost data is not implemented yet.',
        workbookType: 'hot-cost',
        detectedSheets: normalizedHotCost.sheetNames,
        summarySheetName: normalizedHotCost.summarySheetName,
        detectedDaySheets: normalizedHotCost.daySheetNames.length,
        detectedRows: normalizedHotCost.summaryEntries.length,
      });
    }

    const normalized = normalizeCashflowWorkbook(req.file.path);
    const result = await persistNormalizedCashflow(normalized, {
      productionTitle: req.body.productionTitle || req.file.originalname.replace(/\.[^.]+$/, ''),
    });

    return res.json({ ok: true, result });
  } catch (error) {
    return next(error);
  }
});
