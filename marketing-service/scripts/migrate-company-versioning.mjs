import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migrate = async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS normalize_name text`);
    await tx.$executeRawUnsafe(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS type text`);
    await tx.$executeRawUnsafe(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false`);
    await tx.$executeRawUnsafe(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0`);
    await tx.$executeRawUnsafe(`UPDATE companies SET normalize_name = lower(regexp_replace(name, '\\s+', '', 'g')) WHERE normalize_name IS NULL`);
    await tx.$executeRawUnsafe(`UPDATE companies SET type = 'GENERAL' WHERE type IS NULL`);

    await tx.$executeRawUnsafe(`ALTER TABLE company_staffs ADD COLUMN IF NOT EXISTS normalize_name text`);
    await tx.$executeRawUnsafe(`ALTER TABLE company_staffs ADD COLUMN IF NOT EXISTS telp text`);
    await tx.$executeRawUnsafe(`ALTER TABLE company_staffs ADD COLUMN IF NOT EXISTS email text`);
    await tx.$executeRawUnsafe(`ALTER TABLE company_staffs ADD COLUMN IF NOT EXISTS revoked boolean NOT NULL DEFAULT false`);
    await tx.$executeRawUnsafe(`ALTER TABLE company_staffs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0`);
    await tx.$executeRawUnsafe(`UPDATE company_staffs SET normalize_name = lower(regexp_replace(name, '\\s+', '', 'g')) WHERE normalize_name IS NULL`);

    const duplicateCompanies = await tx.$queryRawUnsafe(`
      SELECT normalize_name FROM companies WHERE revoked = false
      GROUP BY normalize_name HAVING count(*) > 1
    `);
    if (duplicateCompanies.length) {
      throw new Error(`Duplicate normalized company names must be resolved first: ${duplicateCompanies.map((row) => row.normalize_name).join(', ')}`);
    }
    const duplicateStaffs = await tx.$queryRawUnsafe(`
      SELECT normalize_name FROM company_staffs WHERE revoked = false
      GROUP BY normalize_name HAVING count(*) > 1
    `);
    if (duplicateStaffs.length) {
      throw new Error(`Duplicate normalized company staff names must be resolved first: ${duplicateStaffs.map((row) => row.normalize_name).join(', ')}`);
    }

    await tx.$executeRawUnsafe(`ALTER TABLE companies ALTER COLUMN normalize_name SET NOT NULL`);
    await tx.$executeRawUnsafe(`ALTER TABLE companies ALTER COLUMN type SET NOT NULL`);
    await tx.$executeRawUnsafe(`ALTER TABLE company_staffs ALTER COLUMN normalize_name SET NOT NULL`);
    await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS companies_normalize_name_version_key`);
    await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS companies_active_normalize_name_key ON companies(normalize_name) WHERE revoked = false`);
    await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS company_staffs_active_normalize_name_key ON company_staffs(normalize_name) WHERE revoked = false`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS companies_revoked_idx ON companies(revoked)`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS company_staffs_revoked_idx ON company_staffs(revoked)`);
  });

  process.stdout.write('Company versioning migration completed\n');
};

await migrate().finally(() => prisma.$disconnect());
