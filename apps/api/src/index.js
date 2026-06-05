import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'cashflow-api' });
});

app.get('/api', (_req, res) => {
  res.json({
    name: 'cashflow-api',
    version: '0.1.0',
    status: 'bootstrapped'
  });
});

app.listen(port, () => {
  console.log(`cashflow api listening on http://localhost:${port}`);
});
