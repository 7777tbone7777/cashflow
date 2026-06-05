import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistNormalizedCashflow } from './persistNormalizedCashflow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const normalizedPath = path.resolve(__dirname, '../../../tmp/cashflow-normalized.json');
const PRODUCTION_ID = '11111111-1111-1111-1111-111111111111';

export async function importSampleCashflowWorkbook() {
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Normalized workbook JSON not found: ${normalizedPath}`);
  }

  const normalized = JSON.parse(fs.readFileSync(normalizedPath, 'utf8'));
  return persistNormalizedCashflow(normalized, {
    productionId: PRODUCTION_ID,
    productionTitle: 'The Children',
  });
}
