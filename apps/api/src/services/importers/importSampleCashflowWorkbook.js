import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const normalizedPath = path.resolve(__dirname, '../../../tmp/cashflow-normalized.json');
const PRODUCTION_ID = '11111111-1111-1111-1111-111111111111';

export async function importSampleCashflowWorkbook() {
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Normalized workbook JSON not found: ${normalizedPath}`);
  }

  const normalized = JSON.parse(fs.readFileSync(normalizedPath, 'utf8'));

  const production = await prisma.production.upsert({
    where: { id: PRODUCTION_ID },
    update: {
      title: 'The Children',
      currency: 'USD',
      status: 'draft',
      notes: 'Imported from sample cash flow workbook during parser persistence spike.',
    },
    create: {
      id: PRODUCTION_ID,
      title: 'The Children',
      currency: 'USD',
      status: 'draft',
      notes: 'Imported from sample cash flow workbook during parser persistence spike.',
    },
  });

  await prisma.cashFlowAllocation.deleteMany({ where: { lineItem: { productionId: production.id } } });
  await prisma.cashFlowLineItem.deleteMany({ where: { productionId: production.id } });
  await prisma.cashFlowPeriod.deleteMany({ where: { productionId: production.id } });
  await prisma.cashFlowSection.deleteMany({ where: { productionId: production.id } });
  await prisma.forecastSnapshot.deleteMany({ where: { productionId: production.id } });
  await prisma.importBatch.deleteMany({ where: { productionId: production.id } });

  const importBatch = await prisma.importBatch.create({
    data: {
      productionId: production.id,
      sourceType: 'cashflow_xlsx',
      originalFilename: path.basename(normalized.sourceFile),
      fileStorageKey: normalized.sourceFile,
      importStatus: 'completed',
      parserVersion: 'spike-v1',
      metadataJson: {
        detailSheetName: normalized.detailSheetName,
        periodCount: normalized.periods.length,
        sectionCount: normalized.sections.length,
        lineItemCount: normalized.lineItems.length,
      },
    },
  });

  await prisma.cashFlowPeriod.createMany({
    data: normalized.periods.map((period) => ({
      productionId: production.id,
      sequence: period.sequence,
      label: period.label,
      periodType: period.periodType,
      sourceColumnKey: String(period.columnIndexZeroBased),
    })),
  });

  await prisma.cashFlowSection.createMany({
    data: normalized.sections.map((section, index) => ({
      productionId: production.id,
      code: section.accountCode || null,
      name: section.name,
      displayOrder: index + 1,
      sourceStartRow: section.sourceStartRow,
      sourceEndRow: section.sourceEndRow || null,
    })),
  });

  const createdPeriods = await prisma.cashFlowPeriod.findMany({ where: { productionId: production.id } });
  const createdSections = await prisma.cashFlowSection.findMany({ where: { productionId: production.id } });
  const periodIdBySequence = new Map(createdPeriods.map((period) => [period.sequence, period.id]));
  const sectionIdByName = new Map(createdSections.map((section) => [section.name, section.id]));

  await prisma.cashFlowLineItem.createMany({
    data: normalized.lineItems.map((lineItem) => ({
      productionId: production.id,
      sectionId: lineItem.sectionName ? sectionIdByName.get(lineItem.sectionName) ?? null : null,
      importBatchId: importBatch.id,
      accountCode: lineItem.accountCode,
      description: lineItem.description || '(blank)',
      lineType: lineItem.lineType,
      sourceRowNumber: lineItem.rowNumber,
      ctdAmount: lineItem.ctdAmount,
      commitmentsAmount: lineItem.commitmentsAmount,
      importedTotal: lineItem.importedTotal,
      formulaJson: { source: 'normalized-spike' },
    })),
  });

  const createdLineItems = await prisma.cashFlowLineItem.findMany({
    where: { productionId: production.id },
    select: { id: true, sourceRowNumber: true },
  });
  const lineItemIdByRowNumber = new Map(createdLineItems.map((lineItem) => [lineItem.sourceRowNumber, lineItem.id]));

  const allocationRows = normalized.lineItems.flatMap((lineItem) => {
    const lineItemId = lineItemIdByRowNumber.get(lineItem.rowNumber);
    if (!lineItemId) return [];

    return (lineItem.allocations || [])
      .map((allocation) => {
        const periodId = periodIdBySequence.get(allocation.periodSequence);
        if (!periodId) return null;
        return {
          lineItemId,
          periodId,
          amount: allocation.amount,
          importedValue: allocation.amount,
        };
      })
      .filter(Boolean);
  });

  if (allocationRows.length) {
    await prisma.cashFlowAllocation.createMany({ data: allocationRows });
  }

  await prisma.forecastSnapshot.create({
    data: {
      productionId: production.id,
      name: 'Initial imported snapshot',
      snapshotType: 'imported',
      totalCtd: normalized.totals.ctd,
      totalCommitments: normalized.totals.commitments,
      weeklyTotalsJson: normalized.totals.weekly,
      cumulativeTotalsJson: normalized.cumulativeTotals,
      createdBy: 'parser-spike',
    },
  });

  return {
    productionId: production.id,
    importBatchId: importBatch.id,
    periods: normalized.periods.length,
    sections: normalized.sections.length,
    lineItems: normalized.lineItems.length,
    allocations: allocationRows.length,
    snapshots: 1,
  };
}
