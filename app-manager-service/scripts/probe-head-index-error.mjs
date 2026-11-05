/**
 * Probes how Prisma reports a partial unique index violation.
 *
 * The single head office branch index is created by `npm run db:migrate`,
 * outside the Prisma schema. The office branch repository maps Prisma's
 * `P2002` to the 409 response, so the index violation must be reported with
 * that code, or a conflicting writer would receive a 500 instead of a 409.
 *
 * Usage: node scripts/probe-head-index-error.mjs
 */
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:admin@127.0.0.1:5432/akura_test_app_manager?schema=public';

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
try {
  // Make sure the probe starts from a known state.
  await prisma.$executeRawUnsafe('DELETE FROM office_branches');
  await prisma.officeBranch.create({
    data: {
      name: 'Probe head',
      address: 'probe',
      telp: '0000',
      email: 'probe@probe.local',
      isHead: true,
    },
  });

  try {
    await prisma.officeBranch.create({
      data: {
        name: 'Probe second head',
        address: 'probe',
        telp: '0000',
        email: 'probe2@probe.local',
        isHead: true,
      },
    });
    console.log('RESULT: no error was raised; the index did not protect the invariant');
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : 'none';
    console.log('RESULT: code =', code);
    console.log('MESSAGE:', error instanceof Error ? error.message : String(error));
  }
} finally {
  await prisma.$executeRawUnsafe('DELETE FROM office_branches');
  await prisma.$disconnect();
}
