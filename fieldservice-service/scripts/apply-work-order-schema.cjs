require('dotenv').config();
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient();
const statements=[
 `DO $$ BEGIN
   IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SpkStatus' AND typnamespace = current_schema()::regnamespace) THEN ALTER TYPE "SpkStatus" RENAME TO "WorkOrderStatus"; END IF;
 END $$`,
 ...['spk','spk_inspectors','spk_sequences','spk_histories'].map(old => {
   const renamed=old.replace('spk','work_order');
   return `DO $$ BEGIN IF to_regclass('${old}') IS NOT NULL AND to_regclass('${renamed}') IS NULL THEN ALTER TABLE ${old} RENAME TO ${renamed}; END IF; END $$`;
 }),
 ...['work_order_inspectors','work_order_histories'].map(table=>`DO $$ BEGIN
   IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='${table}' AND column_name='spk_id') THEN ALTER TABLE ${table} RENAME COLUMN spk_id TO work_order_id; END IF;
 END $$`),
 `DO $$ DECLARE r RECORD; BEGIN
   FOR r IN SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
     WHERE n.nspname=current_schema() AND t.relname IN ('work_order','work_order_inspectors','work_order_sequences','work_order_histories') AND c.conname LIKE 'spk%' LOOP
     EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',r.relname,r.conname,replace(r.conname,'spk','work_order'));
   END LOOP;
   FOR r IN SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND tablename IN ('work_order','work_order_inspectors','work_order_sequences','work_order_histories') AND indexname LIKE 'spk%' LOOP
     EXECUTE format('ALTER INDEX %I RENAME TO %I',r.indexname,replace(r.indexname,'spk','work_order'));
   END LOOP;
 END $$`,
 `DO $$ BEGIN CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT','IN_PROGRESS','COMPLETED','CANCELED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
 `CREATE TABLE IF NOT EXISTS work_order (
  id UUID PRIMARY KEY, office_branch_id UUID NOT NULL, number VARCHAR(100) NOT NULL, date DATE NOT NULL,
  quotation_id UUID, quotation_version INTEGER, quotation_snapshot JSONB,
  start_date DATE NOT NULL, end_date DATE, status "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
  revoked BOOLEAN NOT NULL DEFAULT false, summary TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
  created_by_id UUID NOT NULL, created_by_name TEXT NOT NULL, updated_by_id UUID, updated_by_name TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL
 )`,
 `CREATE UNIQUE INDEX IF NOT EXISTS work_order_office_branch_id_number_key ON work_order(office_branch_id,number)`,
 `CREATE INDEX IF NOT EXISTS work_order_office_branch_id_revoked_created_at_id_idx ON work_order(office_branch_id,revoked,created_at,id)`,
 `CREATE INDEX IF NOT EXISTS work_order_quotation_id_idx ON work_order(quotation_id)`,
 `CREATE TABLE IF NOT EXISTS work_order_inspectors (
  id UUID PRIMARY KEY, work_order_id UUID NOT NULL REFERENCES work_order(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  name VARCHAR(255) NOT NULL, position INTEGER NOT NULL
 )`,
 `CREATE UNIQUE INDEX IF NOT EXISTS work_order_inspectors_work_order_id_position_key ON work_order_inspectors(work_order_id,position)`,
 `CREATE TABLE IF NOT EXISTS work_order_sequences (
  office_branch_id UUID NOT NULL, year INTEGER NOT NULL, last_number INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (office_branch_id,year)
 )`,
 `CREATE TABLE IF NOT EXISTS work_order_histories (
  id UUID PRIMARY KEY, work_order_id UUID NOT NULL REFERENCES work_order(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  version INTEGER NOT NULL, action VARCHAR(20) NOT NULL, before_snapshot JSONB, snapshot JSONB NOT NULL,
  changes JSONB NOT NULL, created_by_id UUID NOT NULL, created_by_name TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
 )`,
 `CREATE UNIQUE INDEX IF NOT EXISTS work_order_histories_work_order_id_version_key ON work_order_histories(work_order_id,version)`,
 `ALTER TABLE work_order ADD COLUMN IF NOT EXISTS contract_id UUID`,
 `ALTER TABLE work_order ADD COLUMN IF NOT EXISTS contract_version INTEGER`,
 `ALTER TABLE work_order ADD COLUMN IF NOT EXISTS contract_snapshot JSONB`,
];
db.$transaction(async tx=>{for(const sql of statements)await tx.$executeRawUnsafe(sql);})
 .then(()=>console.log('Work order schema applied (four additive tables).'))
 .catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
