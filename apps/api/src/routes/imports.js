import { Router } from 'express';
import { importSampleCashflowWorkbook } from '../services/importers/importSampleCashflowWorkbook.js';

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
