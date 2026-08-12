import xlsx from 'xlsx';

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function looksLikeHotCostDaySheet(sheetName) {
  const normalized = cleanText(sheetName);
  return /^\d{6}(\s+PRESHOOT)?$/i.test(normalized) || /^\d{6}$/i.test(normalized) || /PRESHOOT/i.test(normalized);
}

function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[$,()\s]/g, '');
  if (!cleaned) return null;
  const negative = value.includes('(') && value.includes(')');
  const parsed = Number.parseFloat(cleaned);
  if (Number.isNaN(parsed)) return null;
  return negative ? -parsed : parsed;
}

// The day sheet header reads:
//   ... 15 TOTAL/DAY | 16 BUDGET/DAY | 17 (OVER)/UNDER
// Column 17 is the variance, not the cost. Reading it as an actual understates
// the shoot's labour by a factor of twenty-two and reports negative day costs.
const COL_TOTAL_DAY = 15;
const COL_BUDGET_DAY = 16;
const COL_VARIANCE = 17;

// Every day sheet states its own date in D2, which removes any need to parse it
// out of the sheet name.
function readSheetDate(rows) {
  const value = (rows[1] || [])[3];
  if (value == null || value === '') return null;
  if (typeof value === 'number' && value > 20000 && value < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const parsed = new Date(String(value).trim());
  return Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 1950
    ? null
    : parsed.toISOString().slice(0, 10);
}

function summarizeDaySheet(sheetName, sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  const workDate = readSheetDate(rows);
  const headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row[0] === 'ACCT' && row[1] === 'NAME');
  if (headerRowIndex < 0) {
    return {
      sheetName,
      workDate,
      rowCount: 0,
      sampleRows: [],
      entries: [],
    };
  }

  const entries = [];
  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const accountCode = cleanText(row[0]);
    const name = cleanText(row[1]);
    const position = cleanText(row[2]);
    const union = cleanText(row[3]);
    const rate = toNumber(row[4]);
    const actualDayCost = toNumber(row[COL_TOTAL_DAY]);
    const budgetDayCost = toNumber(row[COL_BUDGET_DAY]);
    const dayVariance = toNumber(row[COL_VARIANCE]);

    // Department roll-up rows put a label in the TOTAL/DAY column and restate a
    // variance the crew rows above already carry. Summing them alongside the
    // detail is what turned a real number into a meaningless one.
    // xlsx returns every cell as a formatted string here, so "is it text" is
    // not the test — "is it text that will not parse as money" is.
    const totalCell = cleanText(row[COL_TOTAL_DAY]);
    const isRollUp = totalCell !== '' && actualDayCost === null;
    if (isRollUp) continue;

    // A crew row is identified by an account code, a name or a position. The
    // day summary block at the foot of each sheet carries money and none of
    // those, and counting it alongside the crew doubles the day exactly.
    if (!accountCode && !name && !position) continue;

    entries.push({
      rowNumber: i + 1,
      accountCode: accountCode || null,
      name: name || null,
      position: position || null,
      union: union || null,
      rate,
      actualDayCost,
      budgetDayCost,
      dayVariance,
    });
  }

  return {
    sheetName,
    workDate,
    rowCount: entries.length,
    sampleRows: entries.slice(0, 10),
    entries,
    dayTotals: {
      actual: entries.reduce((sum, e) => sum + (e.actualDayCost || 0), 0),
      budget: entries.reduce((sum, e) => sum + (e.budgetDayCost || 0), 0),
      variance: entries.reduce((sum, e) => sum + (e.dayVariance || 0), 0),
    },
  };
}

export function isHotCostWorkbook(workbook) {
  const sheetNames = workbook.SheetNames.map((name) => cleanText(name));
  return sheetNames.includes('CR WORKSHEET #2') || sheetNames.some(looksLikeHotCostDaySheet);
}

export function normalizeHotCostWorkbook(workbookPath) {
  const workbook = xlsx.readFile(workbookPath, { cellFormula: true, cellDates: false });
  if (!isHotCostWorkbook(workbook)) {
    throw new Error(`Workbook does not appear to be a hot cost workbook. Found sheets: ${workbook.SheetNames.join(', ')}`);
  }

  const summarySheetName = workbook.SheetNames.find((name) => cleanText(name) === 'CR WORKSHEET #2') || null;
  const daySheetNames = workbook.SheetNames.filter((name) => looksLikeHotCostDaySheet(name));

  const summaryRows = summarySheetName
    ? xlsx.utils.sheet_to_json(workbook.Sheets[summarySheetName], {
        header: 1,
        raw: false,
        defval: null,
      })
    : [];

  const headerRowIndex = summaryRows.findIndex((row) => Array.isArray(row) && row[0] === 'ACCT' && row[1] === 'NAME');
  const dayHeaderRow = headerRowIndex >= 0 ? summaryRows[headerRowIndex - 1] || [] : [];
  const columnHeaderRow = headerRowIndex >= 0 ? summaryRows[headerRowIndex] || [] : [];

  const dayColumns = [];
  if (headerRowIndex >= 0) {
    for (let col = 5; col < columnHeaderRow.length; col += 1) {
      const dayLabel = cleanText(dayHeaderRow[col]);
      const dateLabel = cleanText(columnHeaderRow[col]);
      if (dayLabel || dateLabel) {
        dayColumns.push({
          columnIndexZeroBased: col,
          dayLabel,
          dateLabel,
        });
      }
    }
  }

  const summaryEntries = [];
  if (headerRowIndex >= 0) {
    for (let i = headerRowIndex + 1; i < summaryRows.length; i += 1) {
      const row = summaryRows[i] || [];
      const accountCode = cleanText(row[0]);
      const name = cleanText(row[1]);
      const position = cleanText(row[2]);
      const union = cleanText(row[3]);
      const rate = toNumber(row[4]);

      const hasDailyValues = dayColumns.some((column) => toNumber(row[column.columnIndexZeroBased]) !== null);
      if (!accountCode && !name && !position && !hasDailyValues) continue;

      summaryEntries.push({
        rowNumber: i + 1,
        accountCode: accountCode || null,
        name: name || null,
        position: position || null,
        union: union || null,
        rate,
        dailyValues: dayColumns
          .map((column) => ({
            dayLabel: column.dayLabel,
            dateLabel: column.dateLabel,
            amount: toNumber(row[column.columnIndexZeroBased]),
          }))
          .filter((entry) => entry.amount !== null),
      });
    }
  }

  const daySheetSummaries = daySheetNames.map((sheetName) =>
    summarizeDaySheet(sheetName, workbook.Sheets[sheetName])
  );

  return {
    sourceFile: workbookPath,
    workbookType: 'hot-cost',
    summarySheetName,
    sheetNames: workbook.SheetNames,
    daySheetNames,
    dayColumns,
    summaryEntries,
    daySheetSummaries,
  };
}
