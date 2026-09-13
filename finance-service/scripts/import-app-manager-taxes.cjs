// Run once during cutover, after disabling the old App Manager tax writer.
// Reads App Manager; never modifies or deletes its records.
const { PrismaClient: SourceClient } = require('../../app-manager-service/node_modules/@prisma/client');
const { prisma } = require('../dist/config/db.js');
const { enqueueTaxSnapshot } = require('../dist/modules/taxes/tax.repository.js');
const { env } = require('../dist/config/env.js');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const sourceUrl = process.env.APP_MANAGER_DATABASE_URL || dotenv.parse(fs.readFileSync(path.join(__dirname, '../../app-manager-service/.env'))).DATABASE_URL;
const source = new SourceClient({ datasources: { db: { url: sourceUrl } } });
async function main() {
  if (!env.TAX_DELIVERY_TARGETS.length) throw Error('Configure TAX_DELIVERY_TARGETS before importing');
  const rows = await source.tax.findMany({ orderBy: [{ officeBranchId: 'asc' }, { effectiveFrom: 'asc' }] });
  const branches = [...new Set(rows.map(row => row.officeBranchId))].sort();
  const comparable = row => JSON.stringify({ ...row, percentage: row.percentage.toString() });
  await prisma.$transaction(async tx => {
    for (const branch of branches) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tax-branch:' + branch}))`;
      const oldRows = rows.filter(row => row.officeBranchId === branch);
      const existing = await tx.tax.findMany({ where: { officeBranchId: branch }, orderBy: { effectiveFrom: 'asc' } });
      if (existing.length && (existing.length !== oldRows.length || existing.some((row, i) => comparable(row) !== comparable(oldRows[i])))) {
        throw Error('Finance already contains different tax data; import aborted without changes');
      }
      if (!existing.length) await tx.tax.createMany({ data: oldRows.map(row => ({ ...row, percentage: row.percentage.toString() })) });
      await enqueueTaxSnapshot(tx, branch);
    }
  }, { timeout: 60000, maxWait: 10000 });
  console.log(`Imported/verified ${rows.length} tax records across ${branches.length} branches; snapshots queued. Restart Finance to recover deliveries.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await source.$disconnect(); await prisma.$disconnect(); });
