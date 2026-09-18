import { z } from 'zod';
import { listItemSizesSchema } from '../items/item.schemas.js';

export const MAX_EXCEL_ROWS = 2000;
export const MAX_EXCEL_BYTES = 5 * 1024 * 1024;
export const exportItemSizesSchema = listItemSizesSchema.omit({ page: true, limit: true }).extend({ companyId: z.string().uuid().optional() });
export type ExportItemSizesInput = z.infer<typeof exportItemSizesSchema>;
export const importContractExcelSchema = z.object({
  companyId: z.string().uuid(),
  version: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe()),
}).strict();
export type ExcelPriceRow = {
  row: number;
  itemSizeId: string;
  sizeVersion: number;
  priceService: string;
  priceMaintenance: string | null;
};
export class ExcelImportError extends Error {
  constructor(public readonly errors: { row?: number; field?: string; message: string }[], public readonly statusCode = 400) {
    super('Excel import failed; no prices were saved');
  }
}
