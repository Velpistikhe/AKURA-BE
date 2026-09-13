const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Uses a new schema, never writes to the application's existing tables.
exports.withTaxDatabase = async function(serviceRoot, run) {
  require(path.join(serviceRoot, 'node_modules/dotenv')).config({ path: path.join(serviceRoot, '.env') });
  const { PrismaClient } = require(path.join(serviceRoot, 'node_modules/@prisma/client'));
  const baseUrl = process.env.DATABASE_URL;
  const schema = 'tax_test_' + randomUUID().replaceAll('-', '');
  const admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  let client;
  try {
    const result = spawnSync(process.execPath, [path.join(serviceRoot, 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
      cwd: serviceRoot, env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', timeout: 60000,
    });
    if (result.status !== 0) throw Error('Isolated test schema setup failed: ' + result.stderr);
    process.env.DATABASE_URL = url.toString();
    client = require(path.join(serviceRoot, 'dist/config/db.js')).prisma;
    await run(client);
  } finally {
    if (client) await client.$disconnect();
    if (!/^tax_test_[a-f0-9]{32}$/.test(schema)) throw Error('Invalid cleanup schema');
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
    process.env.DATABASE_URL = baseUrl;
  }
};
