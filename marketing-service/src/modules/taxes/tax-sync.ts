import { Prisma } from '@prisma/client';
import { HttpError } from '../../utils/httpError.js';

export async function applicableTax(tx: Prisma.TransactionClient, officeBranchId: string, at: Date) {
  const day = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)}T00:00:00.000Z`);
  const tax = await tx.taxCache.findFirst({ where: { officeBranchId, effectiveFrom: { lte: day },
    OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: day } }] }, orderBy: { effectiveFrom: 'desc' } });
  if (!tax) throw new HttpError('No synchronized tax is available for this branch and quotation date', 503);
  return tax;
}

