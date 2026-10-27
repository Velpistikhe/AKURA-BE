import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { priceContext, quotationSizeInclude, resolveQuotationPrice } from './quotation-price.js';

export const billingPricesSchema = z.object({
  companyId: z.string().uuid(),
  itemSizeIds: z.array(z.string().uuid()).min(1).max(100)
    .refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length, 'Duplicate item size'),
}).strict();
export async function resolveBillingPrices(input: z.infer<typeof billingPricesSchema>, branch: string) {
  return prisma.$transaction(async tx => {
    const now = new Date();
    const context = await priceContext(tx, input.companyId, branch, now);
    const rows = await tx.itemSize.findMany({ where: { id: { in: input.itemSizeIds }, item: { officeBranchId: branch } },
      include: { ...quotationSizeInclude, contractPrices: { where: { contractId: context.contract?.id ?? '00000000-0000-0000-0000-000000000000' } } } });
    if (rows.length !== input.itemSizeIds.length) throw new HttpError('Item size not found in this branch', 404);
    const items = rows.map(row => {
      if (row.item.service && row.item.service.officeBranchId !== branch) throw new HttpError('Item size not found in this branch', 404);
      const price = resolveQuotationPrice(row, context, now);
      if (price.priceStatus !== 'AVAILABLE') throw new HttpError('Item price is unavailable', 409);
      return { itemSizeId: row.id, ...price };
    });
    return { officeBranchId: branch, company: { id: context.company.id, name: context.company.name, isSisterCompany: context.company.isSisterCompany }, items };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
