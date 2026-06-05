import { Router } from 'express';

export const importsRouter = Router();

importsRouter.get('/status', (_req, res) => {
  res.json({
    ok: true,
    importer: 'cashflow-xlsx',
    status: 'scaffolded'
  });
});
