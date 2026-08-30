import { z } from 'zod';
import { createListQueryFields } from '../../utils/listQuery.js';
export const listItemsSchema = z
  .object({
    ...createListQueryFields(['serviceName', 'itemName', 'size'] as const),
    serviceName: z.string().trim().min(1).max(200).optional(),
    itemName: z.string().trim().min(1).max(200).optional(),
    size: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const price = z.coerce.number().min(0);
const size = z
  .object({
    size: z.string().trim().min(1).max(100),
    priceServicePrimary: price,
    priceServiceSisterCompany: price,
    priceMaintenancePrimary: price.nullable().optional(),
    priceMaintenanceSisterCompany: price.nullable().optional(),
  })
  .strict();

export const itemIdSchema = z.object({ itemId: z.string().uuid() }).strict();
export const createItemSchema = z
  .object({
    serviceId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    sizes: z.array(size).min(1).max(100),
  })
  .strict();

export const updateItemSchema = z
  .object({
    serviceId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    sizes: z.array(size).min(1).max(100),
  })
  .strict();

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type ListItemsInput = z.infer<typeof listItemsSchema>;
