import { z } from 'zod';

export const contractPriceHistoryParamsSchema = z.object({ contractPriceId: z.string().uuid() }).strict();
export const contractPriceHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const listContractPricesSchema = z.object({
  contractId: z.string().uuid().optional(), companyId: z.string().uuid().optional(), itemSizeId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  search: z.string().trim().min(1).max(200).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['priceService', 'priceMaintenance', 'effectiveFrom', 'effectiveUntil', 'createdAt', 'updatedAt']).optional(), sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).strict();
