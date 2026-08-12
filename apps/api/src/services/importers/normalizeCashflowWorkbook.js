import xlsx from 'xlsx';

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

// Excel serials, ISO strings and formatted dates all turn up in the same
// column depending on how the workbook was saved.
function parseWeekEnding(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && value > 20000 && value < 60000) {
    // Excel's day zero is 1899-12-30.
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || !/\d/.test(trimmed)) return null;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() > 1950) return parsed;
  }
  return null;
}

function detectPeriodType(label) {
  if (label.startsWith('Pre-Prep')) return 'preprep';
  if (label.startsWith('Prep')) return 'prep';
  if (label.startsWith('Shoot')) return 'shoot';
  if (label.startsWith('Post')) return 'post';
  if (label.startsWith('Hiatus')) return 'hiatus';
  return 'post';
}

function looksLikeSectionHeader(row, totalColumnIndex) {
  const colA = cleanText(row[0]);
  const colB = cleanText(row[1]);
  const colC = cleanText(row[2]);

  // The original rule: an account code in column A with the department name
  // beside it in column B.
  if (colA && colB && !colC) return true;

  // Accountants do not stay consistent about which column the name lands in.
  // In the reference workbook every department from account 4400 onward puts
  // its name in column C, so a column-B-only rule silently folds VFX,
  // Editorial, Music, Post Sound, Post DI, Titles and Publicity into whatever
  // department came before them. Their real signature is an account code
  // ending in 00, a name, and no money on the row.
  const name = colB || colC;
  const acct = colA.replace(/,/g, '');
  const hasMoney = toNumber(row[totalColumnIndex]) !== null;
  if (name && !hasMoney && /^\d{3,4}$/.test(acct) && acct.endsWith('00')) return true;

  // A department can also carry no account code at all — DEPOSITS does.
  if (colB && !colC && !colA && !hasMoney) return true;

  return false;
}

function pickDetailSheet(workbook) {
  const preferredByName = workbook.SheetNames.find((name) => name.toLowerCase().includes('cash flow') && name.toLowerCase().includes('usd'));
  if (preferredByName) return preferredByName;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: null,
    });

    const hasPrePrepHeader = rows.some((row) => Array.isArray(row) && row.some((cell) => typeof cell === 'string' && cell.includes('Pre-Prep')));
    const hasWeeklyTotals = rows.some((row) => Array.isArray(row) && row.some((cell) => cell === 'WEEKLY CASH FLOW TOTALS:'));
    const hasCumulativeTotals = rows.some((row) => Array.isArray(row) && row.some((cell) => cell === 'CUMULATIVE TOTALS:'));

    if (hasPrePrepHeader && hasWeeklyTotals && hasCumulativeTotals) {
      return sheetName;
    }
  }

  return null;
}

export function normalizeCashflowWorkbook(workbookPath) {
  const workbook = xlsx.readFile(workbookPath, { cellFormula: true, cellDates: false });
  const detailSheetName = pickDetailSheet(workbook);

  if (!detailSheetName) {
    throw new Error(`Could not find detail cash flow sheet. Found sheets: ${workbook.SheetNames.join(', ')}`);
  }

  const sheet = workbook.Sheets[detailSheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  const headerRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => typeof cell === 'string' && cell.includes('Pre-Prep')));
  const totalRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => cell === 'WEEKLY CASH FLOW TOTALS:'));
  const cumulativeRowIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => cell === 'CUMULATIVE TOTALS:'));

  if (headerRowIndex < 0 || totalRowIndex < 0 || cumulativeRowIndex < 0) {
    throw new Error('Missing required workbook landmarks');
  }

  const headerRow = rows[headerRowIndex];
  // The row above the labels carries a real week-ending date for every period
  // column. Driving off dates rather than labels does three things: it fills in
  // weekEndingDate, which the schema has always had a column for and never
  // populated; it keeps period columns that carry money but no label, which the
  // label-driven scan dropped silently; and it removes any need to guess when
  // the shoot starts.
  const dateRow = rows[headerRowIndex - 1] || [];
  const totalRowForColumns = rows[totalRowIndex] || [];
  const periods = [];
  const lastColumn = Math.max(headerRow.length, dateRow.length, totalRowForColumns.length);

  for (let col = 6; col < lastColumn; col += 1) {
    const label = cleanText(headerRow[col]);
    const weekEndingDate = parseWeekEnding(dateRow[col]);
    // A column counts as a period if it is dated, or labelled, or carries a
    // figure on the weekly totals row. The grand total column is none of those
    // things by this point — it is excluded below.
    const carriesMoney = toNumber(totalRowForColumns[col]) !== null;
    if (!weekEndingDate && !label && !carriesMoney) continue;
    // The grand total column carries money like any period and is marked TOTAL
    // — but in the date row, not the label row. Missing that counts it as a
    // 37th period and doubles the weekly sum.
    const marker = `${label} ${cleanText(dateRow[col])}`.toUpperCase();
    if (/\bTOTAL\b/.test(marker)) break;

    periods.push({
      sequence: periods.length + 1,
      label: label || (weekEndingDate ? `WE ${weekEndingDate.toISOString().slice(0, 10)}` : `Period ${periods.length + 1}`),
      labelled: Boolean(label),
      weekEndingDate: weekEndingDate ? weekEndingDate.toISOString().slice(0, 10) : null,
      periodType: detectPeriodType(label || ''),
      columnIndexZeroBased: col,
    });
  }

  // The grand total sits in the first column after the last period, wherever
  // that falls. Hardcoding it to 42 worked for one workbook and no others.
  const totalColumnIndex = periods.length
    ? periods[periods.length - 1].columnIndexZeroBased + 1
    : 42;

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

    if (colA === 'Acct') continue;

    if (looksLikeSectionHeader(row, totalColumnIndex)) {
      currentSection = {
        key: `section-${sections.length + 1}`,
        name: colB || colC,
        rowNumber,
        sourceStartRow: rowNumber,
        accountCode: colA,
      };
      sections.push(currentSection);

      lineItems.push({
        rowNumber,
        sectionName: currentSection.name,
        accountCode: colA || null,
        description: colB || colC,
        lineType: 'header',
        ctdAmount: toNumber(row[3]),
        commitmentsAmount: toNumber(row[4]),
        importedTotal: toNumber(row[totalColumnIndex]),
        allocations: [],
      });
      continue;
    }

    if (!description && !colA && !hasMoney) continue;

    const isSubtotal = description.includes('TOTAL') || description.includes('SUBTOTAL');
    const isFringe = description.includes('FRINGE');
    const lineType = isSubtotal ? 'subtotal' : isFringe ? 'fringe' : colA || hasMoney ? 'detail' : 'header';

    const allocations = periods
      .map((period) => ({
        periodSequence: period.sequence,
        label: period.label,
        amount: toNumber(row[period.columnIndexZeroBased]),
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
      importedTotal: toNumber(row[totalColumnIndex]),
      allocations,
    });
  }

  const totalRow = rows[totalRowIndex] || [];
  const cumulativeRow = rows[cumulativeRowIndex] || [];

  const ctd = toNumber(totalRow[3]);
  const commitments = toNumber(totalRow[4]);
  const weeklySum = periods.reduce(
    (sum, period) => sum + (toNumber(totalRow[period.columnIndexZeroBased]) || 0), 0);
  const grandTotal = toNumber(totalRow[totalColumnIndex]);

  // The workbook states the same total twice over: once as a grand total, and
  // once as cost-to-date plus commitments plus every weekly column. If those
  // disagree, the parse has misread something and any schedule built on it
  // would be confidently wrong. Refuse it here rather than downstream.
  const reconciliation = {
    ctd: ctd || 0,
    commitments: commitments || 0,
    weeklySum,
    computedTotal: (ctd || 0) + (commitments || 0) + weeklySum,
    statedTotal: grandTotal,
    periodCount: periods.length,
    unlabelledPeriods: periods.filter((period) => !period.labelled).length,
  };
  reconciliation.difference = grandTotal == null
    ? null
    : reconciliation.computedTotal - grandTotal;
  reconciliation.reconciles = grandTotal == null
    ? false
    : Math.abs(reconciliation.difference) <= Math.max(2, Math.abs(grandTotal) * 0.0005);

  if (!reconciliation.reconciles) {
    throw new Error(
      `Workbook does not reconcile. Cost to date (${reconciliation.ctd.toLocaleString()}) `
      + `plus commitments (${reconciliation.commitments.toLocaleString()}) `
      + `plus ${periods.length} weekly columns (${weeklySum.toLocaleString()}) `
      + `= ${reconciliation.computedTotal.toLocaleString()}, but the workbook states `
      + `${grandTotal == null ? 'no grand total' : grandTotal.toLocaleString()}`
      + `${reconciliation.difference == null ? '' : ` (off by ${reconciliation.difference.toLocaleString()})`}. `
      + `Nothing has been imported.`);
  }

  return {
    sourceFile: workbookPath,
    detailSheetName,
    reconciliation,
    periods,
    sections,
    lineItems,
    totals: {
      ctd,
      commitments,
      weekly: periods.map((period) => ({
        periodSequence: period.sequence,
        label: period.label,
        amount: toNumber(totalRow[period.columnIndexZeroBased]),
      })),
      grandTotal: toNumber(totalRow[42]),
    },
    cumulativeTotals: periods.map((period) => ({
      periodSequence: period.sequence,
      label: period.label,
      amount: toNumber(cumulativeRow[period.columnIndexZeroBased]),
    })),
  };
}
