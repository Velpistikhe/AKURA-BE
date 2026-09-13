import { z } from 'zod';

const percentage = z.union([z.string(), z.number().finite().transform(String)])
  .pipe(z.string().regex(/^\d{1,3}(\.\d{1,2})?$/))
  .refine(value => Number(value) <= 100, 'Tax percentage must be between 0 and 100');
export const createTaxSchema = z.object({
  percentage,
  effectiveFrom: z.string().date().refine(value => value >= '0001-01-01', 'Invalid effective date')
    .transform(value => new Date(`${value}T00:00:00.000Z`)),
}).strict();
