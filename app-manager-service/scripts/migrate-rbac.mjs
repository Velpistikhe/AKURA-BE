import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const permissions = [
  ['user:global:GET:/api/v1/auth/me', 'USER', null, 'GET', '/api/v1/auth/me', 'Read own profile'],
  ['user:global:PUT:/api/v1/auth/profile', 'USER', null, 'PUT', '/api/v1/auth/profile', 'Update own profile'],
  ['user:global:PUT:/api/v1/auth/password', 'USER', null, 'PUT', '/api/v1/auth/password', 'Change own password'],
  ['admin:global:GET:/api/v1/auth/me', 'ADMIN', null, 'GET', '/api/v1/auth/me', 'Read own profile'],
  ['admin:global:PUT:/api/v1/auth/profile', 'ADMIN', null, 'PUT', '/api/v1/auth/profile', 'Update own profile'],
  ['admin:global:PUT:/api/v1/auth/password', 'ADMIN', null, 'PUT', '/api/v1/auth/password', 'Change own password'],
  ['admin:global:GET:/permissions/endpoints', 'ADMIN', null, 'GET', '/permissions/endpoints', 'List endpoint permissions'],
  ['admin:global:GET:/users', 'ADMIN', null, 'GET', '/users', 'List users'],
  ['admin:global:GET:/users/:userId', 'ADMIN', null, 'GET', '/users/:userId', 'Read user detail'],
  ['admin:global:PATCH:/users/:userId/role', 'ADMIN', null, 'PATCH', '/users/:userId/role', 'Update user role'],
  ['admin:global:PATCH:/users/:userId/section', 'ADMIN', null, 'PATCH', '/users/:userId/section', 'Update user section'],
  ['admin:global:PATCH:/users/:userId/status', 'ADMIN', null, 'PATCH', '/users/:userId/status', 'Update user status'],
  ['app_manager:global:GET:/api/v1/auth/me', 'APP_MANAGER', null, 'GET', '/api/v1/auth/me', 'Read own profile'],
  ['app_manager:global:PUT:/api/v1/auth/profile', 'APP_MANAGER', null, 'PUT', '/api/v1/auth/profile', 'Update own profile'],
  ['app_manager:global:PUT:/api/v1/auth/password', 'APP_MANAGER', null, 'PUT', '/api/v1/auth/password', 'Change own password'],
  ['app_manager:HRD_MANAGEMENT:GET:/users', 'APP_MANAGER', 'HRD_MANAGEMENT', 'GET', '/users', 'List users'],
  ['app_manager:HRD_MANAGEMENT:GET:/users/:userId', 'APP_MANAGER', 'HRD_MANAGEMENT', 'GET', '/users/:userId', 'Read user detail'],
  ['app_manager:HRD_MANAGEMENT:PATCH:/users/:userId/section', 'APP_MANAGER', 'HRD_MANAGEMENT', 'PATCH', '/users/:userId/section', 'Update user section'],
  ['app_manager:HRD_MANAGEMENT:PATCH:/users/:userId/status', 'APP_MANAGER', 'HRD_MANAGEMENT', 'PATCH', '/users/:userId/status', 'Update user status'],
];

const migrate = async () => {
  const [roleColumn] = await prisma.$queryRawUnsafe(`
    SELECT udt_name AS "typeName"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'users'
      AND column_name = 'role'
  `);

  if (!roleColumn) throw new Error('users.role column was not found');

  if (roleColumn.typeName !== 'user_role') {
    const unknownRoles = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT role
      FROM users
      WHERE UPPER(role) NOT IN ('USER', 'ADMIN', 'MANAGER', 'APP_MANAGER')
    `);
    if (unknownRoles.length > 0) {
      throw new Error(`Unsupported existing roles: ${unknownRoles.map((item) => item.role).join(', ')}`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`UPDATE users SET role = UPPER(role)`);
      await tx.$executeRawUnsafe(`UPDATE users SET role = 'APP_MANAGER' WHERE role = 'MANAGER'`);
      await tx.$executeRawUnsafe(`
        DO $$ BEGIN
          CREATE TYPE user_role AS ENUM ('USER', 'ADMIN', 'APP_MANAGER');
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$
      `);
      await tx.$executeRawUnsafe(`ALTER TABLE users ALTER COLUMN role DROP DEFAULT`);
      await tx.$executeRawUnsafe(`
        ALTER TABLE users
        ALTER COLUMN role TYPE user_role
        USING role::user_role
      `);
      await tx.$executeRawUnsafe(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'USER'::user_role`);
    });
  } else {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'user_role'::regtype AND enumlabel = 'user') THEN
          ALTER TYPE user_role RENAME VALUE 'user' TO 'USER';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'user_role'::regtype AND enumlabel = 'admin') THEN
          ALTER TYPE user_role RENAME VALUE 'admin' TO 'ADMIN';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'user_role'::regtype AND enumlabel = 'manager') THEN
          ALTER TYPE user_role RENAME VALUE 'manager' TO 'APP_MANAGER';
        ELSIF EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'user_role'::regtype AND enumlabel = 'app_manager') THEN
          ALTER TYPE user_role RENAME VALUE 'app_manager' TO 'APP_MANAGER';
        END IF;
      END $$
    `);
    await prisma.$executeRawUnsafe(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'USER'::user_role`);
  }

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE http_method AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS endpoint_permissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL UNIQUE,
      role user_role NOT NULL,
      section user_section NULL,
      method http_method NOT NULL,
      endpoint text NOT NULL,
      description text NOT NULL DEFAULT '',
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS endpoint_permissions_role_section_method_idx
    ON endpoint_permissions(role, section, method)
  `);

  for (const [key, role, section, method, endpoint, description] of permissions) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO endpoint_permissions
        (key, role, section, method, endpoint, description, is_active, updated_at)
      VALUES ($1, $2::user_role, $3::user_section, $4::http_method, $5, $6, true, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET
        role = EXCLUDED.role,
        section = EXCLUDED.section,
        method = EXCLUDED.method,
        endpoint = EXCLUDED.endpoint,
        description = EXCLUDED.description,
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
    `, key, role, section, method, endpoint, description);
  }

  process.stdout.write(`RBAC migration completed with ${permissions.length} endpoint permissions\n`);
};

await migrate().finally(() => prisma.$disconnect());
