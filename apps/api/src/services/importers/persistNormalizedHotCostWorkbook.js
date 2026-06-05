import path from 'node:path';
import { prisma } from '../../db.js';

function toSummaryMetadata(normalizedHotCost) {
  return {
    workbookType: normalizedHotCost.workbookType,
    summarySheetName: normalizedHotCost.summarySheetName,
    sheetNames: normalizedHotCost.sheetNames,
    daySheetNames: normalizedHotCost.daySheetNames,
    dayColumns: normalizedHotCost.dayColumns,
    summaryEntryCount: normalizedHotCost.summaryEntries.length,
    daySheetSummaries: normalizedHotCost.daySheetSummaries,
  };
}

export async function persistNormalizedHotCostWorkbook(normalizedHotCost, options = {}) {
  const productionTitle = options.productionTitle || path.basename(normalizedHotCost.sourceFile).replace(/\.[^.]+$/, '');

  const production = options.productionId
    ? await prisma.production.update({
        where: { id: options.productionId },
        data: {
          title: productionTitle || undefined,
          notes: `Hot cost workbook uploaded: ${path.basename(normalizedHotCost.sourceFile)}`,
        },
      })
    : await prisma.production.create({
        data: {
          title: productionTitle,
          currency: 'USD',
          status: 'draft',
          notes: `Hot cost workbook uploaded: ${path.basename(normalizedHotCost.sourceFile)}`,
        },
      });

  await prisma.hotCostLineItem.deleteMany({ where: { productionId: production.id } });
  await prisma.hotCostDay.deleteMany({ where: { productionId: production.id } });

  const importBatch = await prisma.importBatch.create({
    data: {
      productionId: production.id,
      sourceType: 'hotcost_xls',
      originalFilename: path.basename(normalizedHotCost.sourceFile),
      fileStorageKey: normalizedHotCost.sourceFile,
      importStatus: 'completed',
      parserVersion: 'hot-cost-v2',
      metadataJson: toSummaryMetadata(normalizedHotCost),
    },
  });

  for (const daySummary of normalizedHotCost.daySheetSummaries) {
    const dayColumnMatch = normalizedHotCost.dayColumns.find(
      (column) => column.dayLabel === daySummary.sheetName || column.dateLabel === daySummary.sheetName,
    );

    const hotCostDay = await prisma.hotCostDay.create({
      data: {
        productionId: production.id,
        importBatchId: importBatch.id,
        sheetName: daySummary.sheetName,
        dayLabel: dayColumnMatch?.dayLabel || null,
        workDateLabel: dayColumnMatch?.dateLabel || null,
      },
    });

    const dayEntries = daySummary.entries || [];

    if (dayEntries.length > 0) {
      await prisma.hotCostLineItem.createMany({
        data: dayEntries.map((row) => ({
          productionId: production.id,
          hotCostDayId: hotCostDay.id,
          accountCode: row.accountCode || null,
          employeeName: row.name || null,
          position: row.position || null,
          unionCode: row.union || null,
          rate: row.rate,
          actualDayCost: row.actualAmount,
          sourceRowNumber: row.rowNumber || null,
        })),
      });
    }
  }

  return {
    productionId: production.id,
    importBatchId: importBatch.id,
    productionTitle: production.title,
    daySheetCount: normalizedHotCost.daySheetNames.length,
    summaryEntryCount: normalizedHotCost.summaryEntries.length,
    persistedDayCount: normalizedHotCost.daySheetSummaries.length,
    persistedLineItemSampleCount: normalizedHotCost.daySheetSummaries.reduce(
      (sum, day) => sum + (day.entries?.length || 0),
      0,
    ),
  };
}
