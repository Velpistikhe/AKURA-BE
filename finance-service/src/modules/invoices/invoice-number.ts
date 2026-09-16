import { Prisma } from '@prisma/client';
import { HttpError } from '../../utils/httpError.js';

export const invoiceDate = (now = new Date()): Date => new Date(`${
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}T00:00:00.000Z`);

// Keep the branch/year lock through document creation and history commit.
export async function nextInvoiceIdentity(tx: Prisma.TransactionClient, officeBranchId: string, clock = () => new Date()) {
  for (;;) {
    const year = invoiceDate(clock()).getUTCFullYear();
    const pattern = `^INV/${year}/([0-9]+)$`;
    // Recover a missing counter from matching historical numbers, including deleted invoices.
    await tx.$executeRaw`
      INSERT INTO invoice_sequences (office_branch_id, year, last_number, created_at, updated_at)
      SELECT ${officeBranchId}::uuid, ${year},
        LEAST(COALESCE(MAX(substring(number from ${pattern})::numeric), 0), 2147483647)::integer,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM billing_documents WHERE office_branch_id = ${officeBranchId}::uuid AND kind = 'INVOICE'
      ON CONFLICT (office_branch_id, year) DO NOTHING
    `;
    const [sequence] = await tx.$queryRaw<Array<{ lastNumber: number }>>`
      SELECT last_number AS "lastNumber" FROM invoice_sequences
      WHERE office_branch_id = ${officeBranchId}::uuid AND year = ${year} FOR UPDATE
    `;
    const date = invoiceDate(clock());
    // A request waiting for a lock across New Year must use the new year's counter.
    if (date.getUTCFullYear() !== year) continue;
    if (!sequence || sequence.lastNumber >= 2147483647) throw new HttpError('Invoice number limit reached for this branch and year', 409);
    const next = sequence.lastNumber + 1;
    await tx.$executeRaw`
      UPDATE invoice_sequences SET last_number = ${next}, updated_at = clock_timestamp()
      WHERE office_branch_id = ${officeBranchId}::uuid AND year = ${year}
    `;
    return { number: `INV/${year}/${String(next).padStart(6, '0')}`, date };
  }
}
