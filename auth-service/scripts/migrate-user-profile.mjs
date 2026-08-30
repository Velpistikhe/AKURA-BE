import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const migrate = async () => {
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
          AND column_name = 'name'
      ) THEN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name text NOT NULL DEFAULT '';
        UPDATE users
        SET last_name = regexp_replace(trim(name), '^\\S+\\s*', '')
        WHERE last_name = '';
        ALTER TABLE users RENAME COLUMN name TO first_name;
        UPDATE users SET first_name = split_part(trim(first_name), ' ', 1);
      ELSE
        ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name text NOT NULL DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name text NOT NULL DEFAULT '';
      END IF;

      ALTER TABLE users DROP COLUMN IF EXISTS email;
      ALTER TABLE users DROP COLUMN IF EXISTS bio;
      ALTER TABLE users ALTER COLUMN first_name DROP DEFAULT;
      ALTER TABLE users ALTER COLUMN last_name DROP DEFAULT;
    END $$;
  `);

  process.stdout.write('User profile migration completed\n');
};

await migrate().finally(() => prisma.$disconnect());
