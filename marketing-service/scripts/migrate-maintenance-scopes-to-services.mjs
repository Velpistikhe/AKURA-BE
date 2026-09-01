import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const columns = await prisma.$queryRaw`
    SELECT column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'maintenance_scopes'
  `;
  const columnNames = new Set(columns.map(({ columnName }) => columnName));

  if (columnNames.has('maintenance_id')) {
    const [orphaned] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS count
      FROM maintenance_scopes scope
      WHERE NOT EXISTS (
        SELECT 1 FROM services service WHERE service.maintenance_id = scope.maintenance_id
      )
    `);
    if (orphaned.count > 0) {
      throw new Error(`Cannot migrate ${orphaned.count} maintenance scope(s) because their maintenance is not linked to a service`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        CREATE TABLE maintenance_scopes_by_service (
          id uuid PRIMARY KEY,
          service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
          scope text NOT NULL,
          revoked boolean NOT NULL DEFAULT false,
          created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamp(3) NOT NULL,
          CONSTRAINT maintenance_scopes_by_service_service_id_scope_key UNIQUE (service_id, scope)
        )
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO maintenance_scopes_by_service (id, service_id, scope, revoked, created_at, updated_at)
        SELECT
          CASE
            WHEN ROW_NUMBER() OVER (PARTITION BY source.id ORDER BY service.id) = 1 THEN source.id
            ELSE gen_random_uuid()
          END,
          service.id,
          source.scope,
          source.revoked,
          source.created_at,
          source.updated_at
        FROM maintenance_scopes source
        INNER JOIN services service ON service.maintenance_id = source.maintenance_id
        ON CONFLICT (service_id, scope) DO NOTHING
      `);
      await tx.$executeRawUnsafe(`DROP TABLE maintenance_scopes`);
      await tx.$executeRawUnsafe(`ALTER TABLE maintenance_scopes_by_service RENAME TO maintenance_scopes`);
      await tx.$executeRawUnsafe(`
        ALTER TABLE maintenance_scopes
        RENAME CONSTRAINT maintenance_scopes_by_service_pkey
        TO maintenance_scopes_pkey
      `);
      await tx.$executeRawUnsafe(`
        ALTER TABLE maintenance_scopes
        RENAME CONSTRAINT maintenance_scopes_by_service_service_id_scope_key
        TO maintenance_scopes_service_id_scope_key
      `);
      await tx.$executeRawUnsafe(`
        ALTER TABLE maintenance_scopes
        RENAME CONSTRAINT maintenance_scopes_by_service_service_id_fkey
        TO maintenance_scopes_service_id_fkey
      `);
      await tx.$executeRawUnsafe(`CREATE INDEX maintenance_scopes_service_id_idx ON maintenance_scopes(service_id)`);
      await tx.$executeRawUnsafe(`CREATE INDEX maintenance_scopes_revoked_idx ON maintenance_scopes(revoked)`);
      await tx.$executeRawUnsafe(`ALTER TABLE services DROP COLUMN IF EXISTS maintenance_id`);
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS maintenances`);
    });
  } else {
    await prisma.$executeRawUnsafe(`ALTER TABLE services DROP COLUMN IF EXISTS maintenance_id`);
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS maintenances`);
  }

  process.stdout.write('Maintenance scopes now belong directly to services\n');
} finally {
  await prisma.$disconnect();
}
