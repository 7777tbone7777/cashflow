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

function summarizeDaySheet(sheetName, sheet) {
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  const headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row[0] === 'ACCT' && row[1] === 'NAME');
  if (headerRowIndex < 0) {
    return {
      sheetName,
      rowCount: 0,
      sampleRows: [],
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
    const amount = toNumber(row[17]);

    if (!accountCode && !name && !position && amount === null) continue;

    entries.push({
      rowNumber: i + 1,
      accountCode: accountCode || null,
      name: name || null,
      position: position || null,
      union: union || null,
      rate,
      actualAmount: amount,
    });
  }

  return {
    sheetName,
    rowCount: entries.length,
    sampleRows: entries.slice(0, 10),
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
