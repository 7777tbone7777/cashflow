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

function isMeaningfulText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function looksLikeSectionLabel(value) {
  if (!isMeaningfulText(value)) return false;
  const trimmed = value.trim();
  if (trimmed.includes('TOTAL')) return false;
  if (trimmed.includes('FRINGE')) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase() && trimmed.length > 2;
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

const headerRow = headerRowIndex >= 0 ? rows[headerRowIndex] : [];
const periodColumns = [];
for (let col = 6; col < headerRow.length; col += 1) {
  const value = headerRow[col];
  if (typeof value === 'string' && value.trim() === '') {
    continue;
  }
  if (value) {
    periodColumns.push({
      sequence: periodColumns.length + 1,
      columnIndexZeroBased: col,
      excelColumnNumber: col + 1,
      label: value
    });
  }
}

const totalRow = totalRowIndex >= 0 ? rows[totalRowIndex] : [];
const cumulativeRow = cumulativeRowIndex >= 0 ? rows[cumulativeRowIndex] : [];

const sectionCandidates = [];
for (let i = 0; i < rows.length; i += 1) {
  const row = rows[i] || [];
  const colB = row[1];
  const colC = row[2];
  if (looksLikeSectionLabel(colB) || looksLikeSectionLabel(colC)) {
    sectionCandidates.push({
      rowNumber: i + 1,
      label: (colB || colC || '').trim(),
      colB,
      colC
    });
  }
}

const output = {
  sourceFile: workbookPath,
  sheetNames: workbook.SheetNames,
  detailSheetName,
  detailSheetRef: sheet['!ref'] || null,
  headerRowNumber: headerRowIndex >= 0 ? headerRowIndex + 1 : null,
  totalRowNumber: totalRowIndex >= 0 ? totalRowIndex + 1 : null,
  cumulativeRowNumber: cumulativeRowIndex >= 0 ? cumulativeRowIndex + 1 : null,
  periodColumns,
  totals: {
    ctd: totalRow[3] ?? null,
    commitments: totalRow[4] ?? null,
    grandTotal: totalRow[42] ?? null
  },
  totalRowPreview: totalRow.slice(0, 45),
  cumulativeRowPreview: cumulativeRow.slice(0, 45),
  sectionCandidates: sectionCandidates.slice(0, 80)
};

const outputPath = path.resolve('apps/api/tmp/cashflow-inspection.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${outputPath}`);
console.log(JSON.stringify({
  detailSheetName,
  headerRowNumber: output.headerRowNumber,
  totalRowNumber: output.totalRowNumber,
  cumulativeRowNumber: output.cumulativeRowNumber,
  periods: periodColumns.length,
  sectionCandidates: sectionCandidates.length,
  totals: output.totals
}, null, 2));
