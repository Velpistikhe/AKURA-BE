/**
 * Database invariants that the Prisma schema cannot express.
 *
 * Prisma has no syntax for a partial unique index, so `prisma db push` never
 * creates it. The service therefore ensures it on start-up: the statements are
 * idempotent, so every boot converges on the same schema state and a
 * deployment that only runs `prisma db push` still ends up with the invariant
 * enforced in the database.
 *
 * The index is the second line of defence. The application guards the rule
 * with a transaction advisory lock, but that lock only protects writers that
 * go through the service. The index protects the data itself, whatever writes
 * it.
 */
import { prisma } from '../config/db.js';
import { logger } from '../utils/logger.js';

/** Advisory lock that serialises the index creation between booting replicas. */
const INVARIANT_LOCK = 'app_manager:office_branch_single_head_index';

/**
 * Creates the partial unique index that enforces the single head office branch
 * invariant: at most one office branch may have `is_head = true`.
 *
 * Fails loudly when the table is missing, because that means the schema was
 * never pushed and the service cannot work anyway.
 */
export const ensureDatabaseInvariants = async (): Promise<void> => {
  const table = await prisma.$queryRaw<Array<{ name: string | null }>>`
    SELECT to_regclass('public.office_branches')::text AS name
  `;
  if (!table[0]?.name) {
    throw new Error(
      'public.office_branches does not exist; run "npm run db:push" before starting the service',
    );
  }

  await prisma.$transaction(async (tx) => {
    // Two replicas may boot at the same time; the lock keeps them from racing
    // on the same index name.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${INVARIANT_LOCK}))`;

    // Duplicate heads would make the index creation fail, so the oldest row is
    // kept and the others are removed. This is the row the application has
    // always treated as the head.
    await tx.$executeRaw`
      DELETE FROM office_branches
      WHERE is_head = true
        AND id NOT IN (
          SELECT id FROM office_branches WHERE is_head = true ORDER BY created_at ASC, id ASC LIMIT 1
        )
    `;

    // The index is built on `is_head`, which is constant (`true`) for every row
    // that passes the WHERE clause. PostgreSQL therefore allows at most one
    // such row: that is the invariant.
    await tx.$executeRaw`
      CREATE UNIQUE INDEX IF NOT EXISTS office_branches_single_head_idx
        ON office_branches (is_head)
        WHERE is_head = true
    `;

    // The comment documents the invariant next to the index in the database.
    await tx.$executeRaw`
      COMMENT ON INDEX office_branches_single_head_idx IS
        'Enforces the single head office branch invariant: at most one row may have is_head = true.'
    `;
  });

  logger.info('Database invariants verified: office_branches_single_head_idx is present.');
};