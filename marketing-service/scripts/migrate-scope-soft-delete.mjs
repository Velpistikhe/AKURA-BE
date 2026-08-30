import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migrate = async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE service_scopes ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false`);
    await tx.$executeRawUnsafe(`ALTER TABLE maintenance_scopes ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS service_scopes_revoked_idx ON service_scopes(revoked)`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS maintenance_scopes_revoked_idx ON maintenance_scopes(revoked)`);
  });

  process.stdout.write('Scope soft-delete migration completed\n');
};

await migrate().finally(() => prisma.$disconnect());
