import path from 'node:path';
import xlsx from 'xlsx';

export function inspectCashflowWorkbook(filePath) {
  const workbook = xlsx.readFile(filePath, { cellFormula: true, cellDates: false });

  return {
    fileName: path.basename(filePath),
    sheetNames: workbook.SheetNames,
    sheets: workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return {
        name: sheetName,
        ref: sheet['!ref'] || null
      };
    })
  };
}
