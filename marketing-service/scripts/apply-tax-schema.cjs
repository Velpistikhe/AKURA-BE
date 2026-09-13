require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS tax_cache_revisions (
  "officeBranchId" UUID PRIMARY KEY, version INTEGER NOT NULL, "eventId" UUID NOT NULL
)`).then(() => console.log('Marketing tax revision schema applied (additive).'))
  .catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
