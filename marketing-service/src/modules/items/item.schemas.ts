import { z } from 'zod';
import { ITEM_LIST_CONFIG, ITEM_SIZE_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';
export const listItemsSchema = z
  .object({
    ...createListQueryFields(ITEM_LIST_CONFIG),
    ...ITEM_LIST_CONFIG.filterFields,
  })
  .strict();

export const listItemSizesSchema = z
  .object({
    itemId: z.string().uuid(),
    ...createListQueryFields(ITEM_SIZE_LIST_CONFIG),
    ...ITEM_SIZE_LIST_CONFIG.filterFields,
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
export const itemSizeIdSchema = z.object({ itemSizeId: z.string().uuid() }).strict();
export const createItemSchema = z
  .object({
    serviceId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    sizes: z.array(size).min(1).max(100),
  })
  .strict();

export const addItemSizeSchema = z
  .object({
    itemId: z.string().uuid(),
    size: z.string().trim().min(1).max(100),
    priceServicePrimary: price,
    priceServiceSisterCompany: price.default(0),
    priceMaintenancePrimary: price.nullable().optional(),
    priceMaintenanceSisterCompany: price.nullable().optional(),
  })
  .strict();

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type AddItemSizeInput = z.infer<typeof addItemSizeSchema>;
export type ListItemsInput = z.infer<typeof listItemsSchema>;
export type ListItemSizesInput = z.infer<typeof listItemSizesSchema>;
