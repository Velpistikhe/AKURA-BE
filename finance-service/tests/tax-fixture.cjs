const { randomUUID } = require('node:crypto');
const path = require('node:path');

// Creates only the Marketing tax-cache tables in an isolated PostgreSQL schema.
exports.withTaxDatabase = async function withTaxDatabase(serviceRoot, run) {
  require(path.join(serviceRoot, 'node_modules/dotenv')).config({ path: path.join(serviceRoot, '.env') });
  const { PrismaClient } = require(path.join(serviceRoot, 'node_modules/@prisma/client'));
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is required for tax fixture');
  const schema = `tax_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  let client;
  const modules = [path.join(serviceRoot, 'dist/config/db.js'), path.join(serviceRoot, 'dist/config/env.js'), path.join(serviceRoot, 'dist/app.js'), path.join(serviceRoot, 'dist/modules/taxes/tax-events.routes.js')];
  await admin.$executeRawUnsafe(`CREATE SCHEMA \"${schema}\"`);
  try {
    const isolated = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await isolated.$executeRawUnsafe(`CREATE TABLE \"${schema}\".\"tax_cache\" (\"id\" uuid PRIMARY KEY, \"office_branch_id\" uuid NOT NULL, \"percentage\" decimal(5,2) NOT NULL, \"effective_from\" date NOT NULL, \"effective_until\" date NULL, \"source_updated_at\" timestamptz NOT NULL)`);
    await isolated.$executeRawUnsafe(`CREATE INDEX \"tax_cache_branch_date_idx\" ON \"${schema}\".\"tax_cache\" (\"office_branch_id\", \"effective_from\")`);
    await isolated.$executeRawUnsafe(`CREATE TABLE \"${schema}\".\"tax_cache_revisions\" (\"officeBranchId\" uuid PRIMARY KEY, \"version\" integer NOT NULL, \"eventId\" uuid NOT NULL)`);
    await isolated.$disconnect();
    process.env.DATABASE_URL = url.toString();
    for (const module of modules) { try { delete require.cache[require.resolve(module)]; } catch { /* not loaded */ } }
    client = require(path.join(serviceRoot, 'dist/config/db.js')).prisma;
    await run(client);
  } finally {
    if (client) await client.$disconnect();
    if (!/^tax_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid cleanup schema');
    await admin.$executeRawUnsafe(`DROP SCHEMA \"${schema}\" CASCADE`);
    await admin.$disconnect();
    process.env.DATABASE_URL = baseUrl;
    for (const module of modules) { try { delete require.cache[require.resolve(module)]; } catch { /* not loaded */ } }
  }
};