import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { importsRouter } from './routes/imports.js';
import { productionsRouter } from './routes/productions.js';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/health', healthRouter);
app.use('/api/imports', importsRouter);
app.use('/api/productions', productionsRouter);
app.get('/api', (_req, res) => {
  res.json({
    name: 'cashflow-api',
    version: '0.1.0',
    status: 'bootstrapped'
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`cashflow api listening on http://localhost:${port}`);
});
