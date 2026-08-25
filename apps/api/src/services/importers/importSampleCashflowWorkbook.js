import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../db.js';
import { persistNormalizedCashflow } from './persistNormalizedCashflow.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const normalizedPath = path.resolve(__dirname, '../../../tmp/cashflow-normalized.json');
const SAMPLE_TITLE = 'The Children';

/**
 * Load the reference cash flow as a production belonging to one user.
 *
 * This used to write to a fixed uuid, which was fine while the app had a single
 * user and is not now: the second person to load the sample would take
 * ownership of the first person's copy and overwrite its contents. The sample
 * is per-user, found by owner rather than by a constant.
 */
export async function importSampleCashflowWorkbook(options = {}) {
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Normalized workbook JSON not found: ${normalizedPath}`);
  }
  const ownerId = options.ownerId ?? null;

  const existing = ownerId
    ? await prisma.production.findFirst({ where: { ownerId, title: SAMPLE_TITLE } })
    : null;

  const normalized = JSON.parse(fs.readFileSync(normalizedPath, 'utf8'));
  return persistNormalizedCashflow(normalized, {
    ownerId,
    productionId: existing?.id,
    productionTitle: SAMPLE_TITLE,
  });
}
