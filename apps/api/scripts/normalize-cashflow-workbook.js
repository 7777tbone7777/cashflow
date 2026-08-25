import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';

// No default. This used to point at a path on the original author's laptop,
// which meant the script failed with "workbook not found" for everyone else and
// looked like a missing file rather than a wrong assumption.
const workbookPath = process.argv[2];

if (!workbookPath) {
  console.error(`Usage: node ${path.basename(process.argv[1])} <path-to-workbook.xlsx>`);
  process.exit(1);
}

if (!fs.existsSync(workbookPath)) {
  console.error(`Workbook not found: ${workbookPath}`);
  process.exit(1);
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[$,()]/g, '').trim();
  if (!cleaned) return null;
  const negative = value.includes('(') && value.includes(')');
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return null;
  return negative ? -parsed : parsed;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function detectPeriodType(label) {
  if (label.startsWith('Pre-Prep')) return 'preprep';
  if (label.startsWith('Prep')) return 'prep';
  if (label.startsWith('Shoot')) return 'shoot';
  if (label.startsWith('Post')) return 'post';
  if (label.startsWith('Hiatus')) return 'hiatus';
  return 'post';
}

function looksLikeSectionHeader(row) {
  const colA = cleanText(row[0]);
  const colB = cleanText(row[1]);
  const colC = cleanText(row[2]);
  return Boolean(colA && colB && !colC);
}

const workbook = xlsx.readFile(workbookPath, { cellFormula: true, cellDates: false });
const detailSheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes('cash flow') && name.toLowerCase().includes('usd'));

if (!detailSheetName) {
  console.error('Could not find detail cash flow sheet');
  process.exit(1);
}

const sheet = workbook.Sheets[detailSheetName];
const rows = xlsx.utils.sheet_to_json(sheet, {
  header: 1,
  raw: false,
  defval: null
});

const headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => typeof cell === 'string' && cell.includes('Pre-Prep')));
const totalRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => cell === 'WEEKLY CASH FLOW TOTALS:'));
const cumulativeRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => cell === 'CUMULATIVE TOTALS:'));

if (headerRowIndex < 0 || totalRowIndex < 0 || cumulativeRowIndex < 0) {
  console.error('Missing required workbook landmarks');
  process.exit(1);
}

const headerRow = rows[headerRowIndex];
const periods = [];
for (let col = 6; col < headerRow.length; col += 1) {
  const label = headerRow[col];
  if (typeof label === 'string' && label.trim() === '') continue;
  if (!label) continue;
  periods.push({
    sequence: periods.length + 1,
    label,
    periodType: detectPeriodType(label),
    columnIndexZeroBased: col
  });
}

const sections = [];
const lineItems = [];
let currentSection = null;

for (let i = headerRowIndex + 1; i < totalRowIndex; i += 1) {
  const row = rows[i] || [];
  const rowNumber = i + 1;
  const colA = cleanText(row[0]);
  const colB = cleanText(row[1]);
  const colC = cleanText(row[2]);
  const description = colC || colB;
  const hasMoney = periods.some((period) => toNumber(row[period.columnIndexZeroBased]) !== null) || toNumber(row[3]) !== null || toNumber(row[4]) !== null;

  if (colA === 'Acct') {
    continue;
  }

  if (looksLikeSectionHeader(row)) {
    currentSection = {
      key: `section-${sections.length + 1}`,
      name: colB,
      rowNumber,
      sourceStartRow: rowNumber,
      accountCode: colA
    };
    sections.push(currentSection);

    lineItems.push({
      rowNumber,
      sectionName: currentSection.name,
      accountCode: colA || null,
      description: colB,
      lineType: 'header',
      ctdAmount: toNumber(row[3]),
      commitmentsAmount: toNumber(row[4]),
      importedTotal: toNumber(row[42]),
      allocations: []
    });
    continue;
  }

  if (!description && !colA && !hasMoney) {
    continue;
  }

  const isSubtotal = description.includes('TOTAL') || description.includes('SUBTOTAL');
  const isFringe = description.includes('FRINGE');
  const lineType = isSubtotal ? 'subtotal' : isFringe ? 'fringe' : colA || hasMoney ? 'detail' : 'header';

  const allocations = periods
    .map((period) => ({
      periodSequence: period.sequence,
      label: period.label,
      amount: toNumber(row[period.columnIndexZeroBased])
    }))
    .filter((entry) => entry.amount !== null);

  if (currentSection && !currentSection.sourceEndRow && isSubtotal) {
    currentSection.sourceEndRow = rowNumber;
  }

  lineItems.push({
    rowNumber,
    sectionName: currentSection?.name || null,
    accountCode: colA || null,
    description,
    lineType,
    ctdAmount: toNumber(row[3]),
    commitmentsAmount: toNumber(row[4]),
    importedTotal: toNumber(row[42]),
    allocations
  });
}

const totalRow = rows[totalRowIndex] || [];
const cumulativeRow = rows[cumulativeRowIndex] || [];

const output = {
  sourceFile: workbookPath,
  detailSheetName,
  periods,
  sections,
  lineItems,
  totals: {
    ctd: toNumber(totalRow[3]),
    commitments: toNumber(totalRow[4]),
    weekly: periods.map((period) => ({
      periodSequence: period.sequence,
      label: period.label,
      amount: toNumber(totalRow[period.columnIndexZeroBased])
    })),
    grandTotal: toNumber(totalRow[42])
  },
  cumulativeTotals: periods.map((period) => ({
    periodSequence: period.sequence,
    label: period.label,
    amount: toNumber(cumulativeRow[period.columnIndexZeroBased])
  }))
};

const outputPath = path.resolve('apps/api/tmp/cashflow-normalized.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${outputPath}`);
console.log(JSON.stringify({
  periods: output.periods.length,
  sections: output.sections.length,
  lineItems: output.lineItems.length,
  firstSection: output.sections[0]?.name || null,
  firstLineItem: output.lineItems[0]?.description || null,
  totals: output.totals
}, null, 2));
