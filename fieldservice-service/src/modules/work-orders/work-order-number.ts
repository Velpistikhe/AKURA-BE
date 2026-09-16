import { Prisma } from '@prisma/client';
import { HttpError } from '../../utils/httpError.js';

export const workOrderDate = (now = new Date()): Date => new Date(`${
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}T00:00:00.000Z`);

// Keep the branch/year lock until the Work order and all inspectors commit.
export async function nextWorkOrderIdentity(tx: Prisma.TransactionClient, officeBranchId: string, clock = () => new Date()) {
  for (;;) {
    const year = workOrderDate(clock()).getUTCFullYear();
    const pattern = `^(?:SPK|WO)/${year}/([0-9]+)$`;
    // Recover a missing counter from matching historical numbers, including deleted work orders.
    await tx.$executeRaw`
      INSERT INTO work_order_sequences (office_branch_id, year, last_number, created_at, updated_at)
      SELECT ${officeBranchId}::uuid, ${year},
        LEAST(COALESCE(MAX(substring(number from ${pattern})::numeric), 0), 2147483647)::integer,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM work_order WHERE office_branch_id = ${officeBranchId}::uuid
      ON CONFLICT (office_branch_id, year) DO NOTHING
    `;
    const [sequence] = await tx.$queryRaw<Array<{ lastNumber: number }>>`
      SELECT last_number AS "lastNumber" FROM work_order_sequences
      WHERE office_branch_id = ${officeBranchId}::uuid AND year = ${year} FOR UPDATE
    `;
    const date = workOrderDate(clock());
    // A request waiting for a lock across New Year must use the new year's counter.
    if (date.getUTCFullYear() !== year) continue;
    if (!sequence || sequence.lastNumber >= 2147483647) throw new HttpError('Work order number limit reached for this branch and year', 409);
    const next = sequence.lastNumber + 1;
    await tx.$executeRaw`
      UPDATE work_order_sequences SET last_number = ${next}, updated_at = clock_timestamp()
      WHERE office_branch_id = ${officeBranchId}::uuid AND year = ${year}
    `;
    return { number: `WO/${year}/${String(next).padStart(6, '0')}`, date };
  }
}
