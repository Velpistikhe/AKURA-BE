// Additive cutover only: does not drop legacy tables or rewrite document history.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const statements = [
  `CREATE TABLE IF NOT EXISTS taxes (
    id UUID PRIMARY KEY, office_branch_id UUID NOT NULL, percentage DECIMAL(5,2) NOT NULL,
    effective_from DATE NOT NULL, effective_until DATE, created_by_id UUID NOT NULL,
    created_by_name TEXT NOT NULL, updated_by_id UUID, updated_by_name TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS taxes_office_branch_id_effective_from_key ON taxes(office_branch_id,effective_from)`,
  `ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS tax_source_id UUID`,
  `ALTER TABLE billing_documents ADD COLUMN IF NOT EXISTS tax DECIMAL(5,2)`,
  `CREATE TABLE IF NOT EXISTS tax_revisions ("officeBranchId" UUID PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS tax_events (id UUID PRIMARY KEY, "officeBranchId" UUID NOT NULL,
    version INTEGER NOT NULL, payload JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "tax_events_officeBranchId_version_key" ON tax_events("officeBranchId",version)`,
  `CREATE TABLE IF NOT EXISTS tax_deliveries (id UUID PRIMARY KEY, "eventId" UUID NOT NULL REFERENCES tax_events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    "targetService" TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "deliveredAt" TIMESTAMP(3), "lastError" TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "tax_deliveries_eventId_targetService_key" ON tax_deliveries("eventId","targetService")`,
  `CREATE INDEX IF NOT EXISTS "tax_deliveries_deliveredAt_nextRetryAt_idx" ON tax_deliveries("deliveredAt","nextRetryAt")`,
];
db.$transaction(async tx => {
  for (const statement of statements) await tx.$executeRawUnsafe(statement);
}).then(() => console.log('Finance tax schema applied (additive).'))
  .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
