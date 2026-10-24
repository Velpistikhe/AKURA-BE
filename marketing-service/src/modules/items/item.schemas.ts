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

export const listContractItemSizesSchema = listItemSizesSchema.extend({
  companyId: z.string().uuid(),
  exclude: z.string().transform(value => value.split(',').map(id => id.trim()))
    .pipe(z.array(z.string().uuid()).min(1).max(100)).optional(),
}).transform(({ exclude, ...query }) => ({
  ...query,
  // Keep the existing notIn parameter compatible and apply both filters together.
  notIn: exclude || query.notIn
    ? [...new Set([...(query.notIn ?? []), ...(exclude ?? [])].map(id => id.toLowerCase()))]
    : undefined,
}));
export type ListContractItemSizesInput = z.infer<typeof listContractItemSizesSchema>;
export const contractPriceOptionsParamsSchema = z.object({ contractId: z.string().uuid() }).strict();
export type ContractPriceOptionsParams = z.infer<typeof contractPriceOptionsParamsSchema>;
export const listContractPriceOptionsSchema = listItemSizesSchema;
export type ListContractPriceOptionsInput = z.infer<typeof listContractPriceOptionsSchema>;

// Do not coerce null, blank strings or booleans to zero.
const price = z.union([z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100), z.string().regex(/^\d{1,16}(\.\d{1,2})?$/)])
  .refine((value) => typeof value === 'string' || /^\d+(\.\d{1,2})?$/.test(String(value)), 'Price must have at most two decimal places');
const priceFields = {
  priceServicePrimary: price,
  priceServiceSisterCompany: price.nullable().optional(),
  priceMaintenancePrimary: price.nullable().optional(),
  priceMaintenanceSisterCompany: price.nullable().optional(),
};
export const versionSchema = z.object({ version: z.number().int().nonnegative() }).strict();
export const referenceLabel = (max: number) => z.string().trim().min(1).max(max).transform(value => value.normalize('NFKC').replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(max));
export const referenceKey = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export const updateItemSchema = versionSchema.extend({ name: referenceLabel(200).optional(), uom: referenceLabel(50).optional() })
  .refine(value => value.name !== undefined || value.uom !== undefined, 'At least one editable field is required');
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export const createItemPriceSchema = z.object(priceFields).strict();
export const updateItemPriceSchema = createItemPriceSchema.partial().extend({ version: versionSchema.shape.version, isActive: z.boolean().optional() })
  .refine(value => Object.keys(value).some(key => key !== 'version'), 'At least one editable field is required');
export type UpdatePriceInput = z.infer<typeof updateItemPriceSchema>;
export const contractPriceIdSchema = z.object({ contractPriceId: z.string().uuid() }).strict();
export const createContractPriceSchema = z.object({ contractId: z.string().uuid(), priceService: price, priceMaintenance: price.nullable().optional() }).strict();
export const updateContractPriceSchema = versionSchema.extend({ priceService: price.optional(), priceMaintenance: price.nullable().optional(), isActive: z.boolean().optional() })
  .refine(value => Object.keys(value).some(key => key !== 'version'), 'At least one editable field is required');
export type PriceInput = z.infer<typeof createItemPriceSchema>;
export type ContractPriceInput = z.infer<typeof createContractPriceSchema>;
// Standard prices travel with a size. The same fields are accepted when creating an
// item with sizes and when adding a single size to an existing item.
const sizePriceFields = {
  priceServicePrimary: price.optional(),
  priceServiceSisterCompany: price.nullable().optional(),
  priceMaintenancePrimary: price.nullable().optional(),
  priceMaintenanceSisterCompany: price.nullable().optional(),
};
const size = z.object({
  size: referenceLabel(100).nullable(),
  // Optional normal and sister prices, validated like POST /items/sizes/:itemSizeId/price.
  ...sizePriceFields,
}).strict();

export const itemIdSchema = z.object({ itemId: z.string().uuid() }).strict();
export const itemSizeIdSchema = z.object({ itemSizeId: z.string().uuid() }).strict();
export const createItemSchema = z
  .object({
    serviceId: z.string().uuid().optional(),
  inspectionScopes: z.array(referenceLabel(500)).max(100).default([])
    .refine(values => new Set(values.map(referenceKey)).size === values.length, 'Inspection scopes must be unique'),
  maintenanceScopes: z.array(referenceLabel(500)).max(100).default([])
    .refine(values => new Set(values.map(referenceKey)).size === values.length, 'Maintenance scopes must be unique'),
    name: referenceLabel(200),
    uom: referenceLabel(50),
    sizes: z.array(size).max(100).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.serviceId && (value.inspectionScopes.length || value.maintenanceScopes.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['serviceId'], message: 'An item with a service cannot have scopes' });
    }
  });

export const addItemSizeSchema = z.object({
  itemId: z.string().uuid(),
  itemVersion: versionSchema.shape.version,
  size: referenceLabel(100).nullable(),
  // Optional normal and sister prices, validated like POST /items/sizes/:itemSizeId/price.
  ...sizePriceFields,
}).strict();

export const createItemScopeSchema = z.object({
  inspectionScope: referenceLabel(500).optional(),
  scope: referenceLabel(500).optional(),
}).strict().refine(value => (value.inspectionScope !== undefined) !== (value.scope !== undefined), 'Provide exactly one scope field');
export const itemInspectionScopeIdSchema = z.object({ itemId: z.string().uuid(), inspectionScopeId: z.string().uuid() }).strict();
export const itemMaintenanceScopeIdSchema = z.object({ itemId: z.string().uuid(), scopeId: z.string().uuid() }).strict();
export type CreateItemScopeInput = z.infer<typeof createItemScopeSchema>;

export const itemHistorySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type AddItemSizeInput = z.infer<typeof addItemSizeSchema>;
export type ListItemsInput = z.infer<typeof listItemsSchema>;
export type ListItemSizesInput = z.infer<typeof listItemSizesSchema>;
