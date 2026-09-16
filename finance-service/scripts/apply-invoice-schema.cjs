// Additive schema change; existing billing documents and history are preserved.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS invoice_sequences (
  office_branch_id UUID NOT NULL,
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (office_branch_id, year)
)`).then(() => console.log('Finance invoice sequence schema applied.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
