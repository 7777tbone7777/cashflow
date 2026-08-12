/**
 * The primary flow: a budget goes in, the two documents a production needs come
 * out.
 *
 * Everything the app did before this worked the other way round — it imported a
 * cash flow and a hot cost that somebody had already built by hand. Those
 * imports still matter, for a production already under way and for learning
 * spread shapes from past shows, but they are the secondary path now.
 */

import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { Router } from 'express';
import { prisma } from '../db.js';
import {
  ExtractorError,
  extractBudget,
  extractorHealth,
  generateCashflow,
  generateHotCost,
} from '../services/extractor.js';

const uploadDir = path.resolve('apps/api/uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 },
});

export const budgetsRouter = Router();

function fail(res, error) {
  if (error instanceof ExtractorError) {
    return res.status(error.status || 502).json({
      error: error.message,
      detail: error.detail ?? null,
    });
  }
  throw error;
}

budgetsRouter.get('/health', async (_req, res) => {
  res.json({ extractor: await extractorHealth() });
});

/**
 * Upload a budget. Extracts it, records it against a production, and returns
 * both the structured budget and the short list of things it could not work out
 * on its own.
 */
budgetsRouter.post('/upload', upload.single('budget'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'A budget file is required.' });
    }

    let extract;
    try {
      extract = await extractBudget({
        buffer: req.file.buffer,
        filename: req.file.originalname,
      });
    } catch (error) {
      return fail(res, error);
    }

    const detected = extract.production?.production_type || {};
    const grandTotal = extract.totals?.grand_total ?? null;
    const coverage = extract.totals?.extraction_coverage ?? null;

    // An extract that does not account for the whole budget is not a basis for
    // a schedule. Say so rather than storing it and letting it look official.
    if (coverage != null && coverage < 0.98) {
      return res.status(422).json({
        error: `The extract accounts for only ${(coverage * 100).toFixed(1)}% of the stated total, `
          + 'so it is not a reliable basis for a schedule.',
        totals: extract.totals,
        warnings: extract.warnings || [],
      });
    }

    const title = req.body.productionTitle?.trim()
      || extract.production?.production_number
      || req.file.originalname.replace(/\.[^.]+$/, '');

    const production = req.body.productionId
      ? await prisma.production.update({
        where: { id: req.body.productionId },
        data: { title, notes: `Budget imported: ${req.file.originalname}` },
      })
      : await prisma.production.create({
        data: {
          title,
          currency: 'USD',
          status: 'draft',
          notes: `Budget imported: ${req.file.originalname}`,
        },
      });

    const batch = await prisma.importBatch.create({
      data: {
        productionId: production.id,
        sourceType: 'budget_pdf',
        originalFilename: req.file.originalname,
        fileStorageKey: `memory:${req.file.originalname}`,
        importStatus: 'completed',
        parserVersion: extract.source?.parser_version || 'budget-extract-1.0',
        metadataJson: extract,
      },
    });

    return res.json({
      ok: true,
      productionId: production.id,
      importBatchId: batch.id,
      productionType: detected,
      grandTotal,
      accounts: extract.accounts?.length ?? 0,
      departments: extract.topsheet?.length ?? 0,
      inputsRequired: extract.inputs_required || [],
      warnings: extract.warnings || [],
    });
  } catch (error) {
    return next(error);
  }
});

/** The most recent budget extract stored against a production. */
async function loadBudget(productionId) {
  const batch = await prisma.importBatch.findFirst({
    where: { productionId, sourceType: 'budget_pdf' },
    orderBy: { createdAt: 'desc' },
  });
  return batch?.metadataJson || null;
}

budgetsRouter.get('/:productionId', async (req, res, next) => {
  try {
    const budget = await loadBudget(req.params.productionId);
    if (!budget) {
      return res.status(404).json({ error: 'No budget has been imported for this production.' });
    }
    return res.json({
      production: budget.production,
      totals: budget.totals,
      topsheet: budget.topsheet,
      inputsRequired: budget.inputs_required || [],
      warnings: budget.warnings || [],
      accountCount: budget.accounts?.length ?? 0,
    });
  } catch (error) {
    return next(error);
  }
});

/** Generate hot cost day sheets and stream them back as a workbook. */
budgetsRouter.post('/:productionId/generate/hotcost', async (req, res, next) => {
  try {
    const budget = await loadBudget(req.params.productionId);
    if (!budget) {
      return res.status(404).json({ error: 'Import a budget for this production first.' });
    }

    let upstream;
    try {
      upstream = await generateHotCost({ budget, config: req.body?.config || req.body || {} });
    } catch (error) {
      return fail(res, error);
    }

    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="hotcost-${req.params.productionId}.xlsx"`);
    for (const header of ['x-crew-count', 'x-day-sheets']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return res.send(buffer);
  } catch (error) {
    return next(error);
  }
});

/**
 * Generate a weekly cash flow and store it as a forecast snapshot.
 *
 * The extractor refuses to emit a grid that does not reconcile to the budget,
 * so anything that arrives here has already tied.
 */
budgetsRouter.post('/:productionId/generate/cashflow', async (req, res, next) => {
  try {
    const budget = await loadBudget(req.params.productionId);
    if (!budget) {
      return res.status(404).json({ error: 'Import a budget for this production first.' });
    }

    let result;
    try {
      result = await generateCashflow({
        budget,
        config: req.body?.config || req.body || {},
        archetypes: req.body?.archetypes || null,
        overrides: req.body?.overrides || null,
        force: Boolean(req.body?.force),
      });
    } catch (error) {
      return fail(res, error);
    }

    const weeklyTotals = result.periods.map((period, index) => ({
      periodSequence: period.index + 1,
      label: period.label,
      weekEndingDate: period.week_ending,
      amount: result.weekly_cash[index] ?? 0,
    }));
    const cumulativeTotals = result.periods.map((period, index) => ({
      periodSequence: period.index + 1,
      label: period.label,
      amount: result.cumulative_cash[index] ?? 0,
    }));

    const snapshot = await prisma.forecastSnapshot.create({
      data: {
        productionId: req.params.productionId,
        name: `Generated ${new Date().toISOString().slice(0, 10)}`,
        snapshotType: 'recalculated',
        grandTotal: result.reconciliation.budget_grand_total,
        weeklyTotalsJson: weeklyTotals,
        cumulativeTotalsJson: cumulativeTotals,
        createdBy: 'generated-from-budget',
      },
    });

    return res.json({
      ok: true,
      snapshotId: snapshot.id,
      periods: result.periods.length,
      reconciliation: result.reconciliation,
      placementBasis: result.placement_basis,
      // Every assumption the generator made, so none of them are silent.
      assumptions: result.assumptions || [],
    });
  } catch (error) {
    return next(error);
  }
});
