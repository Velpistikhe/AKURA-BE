import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migrate = async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE companies ADD COLUMN IF NOT EXISTS office_branch_id uuid');
    await tx.$executeRawUnsafe('ALTER TABLE services ADD COLUMN IF NOT EXISTS office_branch_id uuid');
    await tx.$executeRawUnsafe('ALTER TABLE items ADD COLUMN IF NOT EXISTS office_branch_id uuid');

    await tx.$executeRawUnsafe(`
      UPDATE items AS item
      SET office_branch_id = service.office_branch_id
      FROM services AS service
      WHERE item.service_id = service.id
        AND item.office_branch_id IS DISTINCT FROM service.office_branch_id
    `);

    const [missing] = await tx.$queryRawUnsafe(`
      SELECT
        (SELECT count(*)::int FROM companies WHERE office_branch_id IS NULL) AS "companies",
        (SELECT count(*)::int FROM services WHERE office_branch_id IS NULL) AS "services",
        (SELECT count(*)::int FROM items WHERE office_branch_id IS NULL) AS "items"
    `);
    if (missing.companies || missing.services || missing.items) {
      throw new Error(
        `All existing records must already have office_branch_id before migration `
        + `(companies=${missing.companies}, services=${missing.services}, items=${missing.items})`,
      );
    }

    await tx.$executeRawUnsafe('ALTER TABLE companies ALTER COLUMN office_branch_id SET NOT NULL');
    await tx.$executeRawUnsafe('ALTER TABLE services ALTER COLUMN office_branch_id SET NOT NULL');
    await tx.$executeRawUnsafe('ALTER TABLE items ALTER COLUMN office_branch_id SET NOT NULL');
    await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS companies_office_branch_id_idx ON companies(office_branch_id)');
    await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS services_office_branch_id_idx ON services(office_branch_id)');
    await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS items_office_branch_id_idx ON items(office_branch_id)');

    await tx.$executeRawUnsafe('DROP INDEX IF EXISTS companies_active_normalize_name_key');
    await tx.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS companies_branch_active_normalize_name_key
      ON companies(office_branch_id, normalize_name)
      WHERE revoked = false
    `);
  }, { maxWait: 10_000, timeout: 120_000 });

  process.stdout.write('Marketing office branch ownership migration completed\n');
};

await migrate().finally(() => prisma.$disconnect());
