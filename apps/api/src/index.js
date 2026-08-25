import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health.js';
import { importsRouter } from './routes/imports.js';
import { productionsRouter } from './routes/productions.js';
import { exportsRouter } from './routes/exports.js';
import { budgetsRouter } from './routes/budgets.js';
import { authRouter } from './routes/auth.js';
import { invitesRouter } from './routes/invites.js';
import { attachUser, requireAuth } from './auth/middleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, '../../web/dist');

const app = express();
const port = process.env.PORT || 3001;

// Credentials are carried in a cookie, so a browser on a different origin (the
// Vite dev server) has to be allowed to send it, and `*` is not permitted with
// credentials. In production the API serves the SPA itself and this is moot.
app.use(cors({ origin: process.env.WEB_ORIGIN || true, credentials: true }));
app.use(express.json());

// Who is asking. Runs before everything, rejects nothing.
app.use(attachUser);

app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/invites', invitesRouter);

// Everything past this point is somebody's work, and it is theirs alone.
app.use('/api/imports', requireAuth, importsRouter);
app.use('/api/productions', requireAuth, productionsRouter);
app.use('/api/exports', requireAuth, exportsRouter);
app.use('/api/budgets', requireAuth, budgetsRouter);
app.get('/api', (_req, res) => {
  res.json({
    name: 'cashflow-api',
    version: '0.1.0',
    status: 'bootstrapped',
  });
});

app.use(express.static(webDistPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
    return next();
  }

  return res.sendFile(path.join(webDistPath, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error?.message || 'Internal server error' });
});

app.listen(port, () => {
  console.log(`cashflow server listening on http://localhost:${port}`);
});
