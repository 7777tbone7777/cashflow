import { prisma } from '../src/db.js';
import { importSampleCashflowWorkbook } from '../src/services/importers/importSampleCashflowWorkbook.js';

importSampleCashflowWorkbook()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
