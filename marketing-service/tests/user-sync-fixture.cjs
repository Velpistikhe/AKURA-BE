const { randomUUID } = require('node:crypto');
const path = require('node:path');

// Creates only the Marketing user-sync read-model tables in an isolated schema.
exports.withUserSyncDatabase = async function withUserSyncDatabase(serviceRoot, run) {
  require(path.join(serviceRoot, 'node_modules/dotenv')).config({ path: path.join(serviceRoot, '.env') });
  const { PrismaClient } = require(path.join(serviceRoot, 'node_modules/@prisma/client'));
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error('DATABASE_URL is required for user-sync fixture');
  const schema = `user_sync_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new PrismaClient({ datasources: { db: { url: baseUrl } } });
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  let client;
  const modules = [
    path.join(serviceRoot, 'dist/config/db.js'),
    path.join(serviceRoot, 'dist/config/env.js'),
    path.join(serviceRoot, 'dist/app.js'),
    path.join(serviceRoot, 'dist/modules/user-sync/user-sync-events.routes.js'),
  ];
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  try {
    const isolated = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    await isolated.$executeRawUnsafe(`CREATE TABLE "${schema}"."marketing_admin_users" ("id" uuid PRIMARY KEY, "office_branch_id" uuid NOT NULL, "username" text NOT NULL, "first_name" text NOT NULL, "last_name" text NOT NULL, "email" varchar(255) NULL, "telp" varchar(50) NULL, "source_version" integer NOT NULL, "source_created_at" timestamptz NOT NULL, "source_updated_at" timestamptz NOT NULL)`);
    await isolated.$executeRawUnsafe(`CREATE INDEX "marketing_admin_users_branch_idx" ON "${schema}"."marketing_admin_users" ("office_branch_id", "source_created_at", "id")`);
    await isolated.$executeRawUnsafe(`CREATE TABLE "${schema}"."marketing_user_sync_revisions" ("user_id" uuid PRIMARY KEY, "version" integer NOT NULL, "event_id" uuid NOT NULL)`);
    await isolated.$disconnect();
    process.env.DATABASE_URL = url.toString();
    for (const module of modules) { try { delete require.cache[require.resolve(module)]; } catch { /* not loaded */ } }
    client = require(path.join(serviceRoot, 'dist/config/db.js')).prisma;
    await run(client);
  } finally {
    if (client) await client.$disconnect();
    if (!/^user_sync_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid cleanup schema');
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
    process.env.DATABASE_URL = baseUrl;
    for (const module of modules) { try { delete require.cache[require.resolve(module)]; } catch { /* not loaded */ } }
  }
};
