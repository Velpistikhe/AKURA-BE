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
    itemId: z.string().uuid().optional(),
    ...createListQueryFields(ITEM_SIZE_LIST_CONFIG),
    ...ITEM_SIZE_LIST_CONFIG.filterFields,
  })
  .strict();

export const listContractItemSizesSchema = listItemSizesSchema.extend({ companyId: z.string().uuid() });
export type ListContractItemSizesInput = z.infer<typeof listContractItemSizesSchema>;

// Do not coerce null, blank strings or booleans to zero.
const price = z.union([z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100), z.string().regex(/^\d{1,16}(\.\d{1,2})?$/)])
  .refine((value) => typeof value === 'string' || /^\d+(\.\d{1,2})?$/.test(String(value)), 'Price must have at most two decimal places');
const priceFields = {
  priceServicePrimary: price,
  priceServiceSisterCompany: price,
  priceMaintenancePrimary: price.nullable().optional(),
  priceMaintenanceSisterCompany: price.nullable().optional(),
};
export const versionSchema = z.object({ version: z.number().int().nonnegative() }).strict();
export const updateItemSchema = versionSchema.extend({ name: z.string().trim().min(1).max(200) });
export const updateItemSizeSchema = versionSchema.extend({ size: z.string().trim().min(1).max(100) });
export const createItemPriceSchema = z.object(priceFields).strict();
export const updateItemPriceSchema = versionSchema.extend({ ...priceFields, isActive: z.boolean().optional() });
export const contractPriceIdSchema = z.object({ contractPriceId: z.string().uuid() }).strict();
export const createContractPriceSchema = z.object({ contractId: z.string().uuid(), priceService: price, priceMaintenance: price.nullable().optional() }).strict();
export const updateContractPriceSchema = versionSchema.extend({ priceService: price, priceMaintenance: price.nullable().optional(), isActive: z.boolean().optional() });
export const catalogHistorySchema = z.object({
  entityType: z.enum(['ITEM', 'ITEM_SIZE', 'ITEM_PRICE', 'COMPANY_CONTRACT_PRICE', 'COMPANY_CONTRACT']), entityId: z.string().uuid(),
  page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type PriceInput = z.infer<typeof createItemPriceSchema>;
export type ContractPriceInput = z.infer<typeof createContractPriceSchema>;
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
    itemVersion: z.number().int().nonnegative(),
    size: z.string().trim().min(1).max(100),
    priceServicePrimary: price,
    priceServiceSisterCompany: price,
    priceMaintenancePrimary: price.nullable().optional(),
    priceMaintenanceSisterCompany: price.nullable().optional(),
  })
  .strict();

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type AddItemSizeInput = z.infer<typeof addItemSizeSchema>;
export type ListItemsInput = z.infer<typeof listItemsSchema>;
export type ListItemSizesInput = z.infer<typeof listItemSizesSchema>;
