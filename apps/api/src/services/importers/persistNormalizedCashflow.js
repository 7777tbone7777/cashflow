import path from 'node:path';
import { prisma } from '../../db.js';

export async function persistNormalizedCashflow(normalized, options = {}) {
  const productionTitle = options.productionTitle || path.basename(normalized.sourceFile).replace(/\.[^.]+$/, '');
  const productionId = options.productionId;

  const production = productionId
    ? await prisma.production.upsert({
        where: { id: productionId },
        update: {
          title: productionTitle,
          currency: 'USD',
          status: 'draft',
          notes: `Imported from workbook ${path.basename(normalized.sourceFile)}.`,
        },
        create: {
          id: productionId,
          title: productionTitle,
          currency: 'USD',
          status: 'draft',
          notes: `Imported from workbook ${path.basename(normalized.sourceFile)}.`,
        },
      })
    : await prisma.production.create({
        data: {
          title: productionTitle,
          currency: 'USD',
          status: 'draft',
          notes: `Imported from workbook ${path.basename(normalized.sourceFile)}.`,
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
      parserVersion: 'upload-v1',
      metadataJson: {
        detailSheetName: normalized.detailSheetName,
        periodCount: normalized.periods.length,
        sectionCount: normalized.sections.length,
        lineItemCount: normalized.lineItems.length,
        reconciliation: normalized.reconciliation || null,
      },
    },
  });

  await prisma.cashFlowPeriod.createMany({
    data: normalized.periods.map((period) => ({
      productionId: production.id,
      sequence: period.sequence,
      label: period.label,
      periodType: period.periodType,
      weekEndingDate: period.weekEndingDate ? new Date(period.weekEndingDate) : null,
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
      formulaJson: { source: 'normalized-upload' },
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
      name: 'Imported snapshot',
      snapshotType: 'imported',
      totalCtd: normalized.totals.ctd,
      totalCommitments: normalized.totals.commitments,
      grandTotal: normalized.totals.grandTotal,
      weeklyTotalsJson: normalized.totals.weekly,
      cumulativeTotalsJson: normalized.cumulativeTotals,
      createdBy: 'upload-import',
    },
  });

  return {
    productionId: production.id,
    importBatchId: importBatch.id,
    productionTitle: production.title,
    periods: normalized.periods.length,
    sections: normalized.sections.length,
    lineItems: normalized.lineItems.length,
    allocations: allocationRows.length,
    snapshots: 1,
    grandTotal: normalized.totals.grandTotal,
    reconciliation: normalized.reconciliation || null,
  };
}
