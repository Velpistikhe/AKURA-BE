import { z } from 'zod';
const date = z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`));
const fields = {
  number: z.string().trim().min(1).max(100).transform(value => value.toUpperCase()),
  title: z.string().trim().min(1).max(255), date,
  content: z.string().trim().min(1).max(100000),
  notes: z.string().trim().max(20000).nullable().optional(),
  status: z.enum(['DRAFT', 'FINAL']).optional(),
};
export const versionSchema = z.number().int().min(0).max(2147483646);
export const createSchema = z.object({ ...fields, quotationId: z.string().uuid(), quotationVersion: versionSchema }).strict();
export const updateSchema = z.object({ ...fields }).partial().extend({ version: versionSchema, reason: z.string().trim().min(1).max(1000).optional() }).strict().refine(value => Object.keys(value).some(key => !['version','reason'].includes(key)), 'At least one editable field is required');
export const deleteSchema = z.object({ version: versionSchema, reason: z.string().trim().min(1).max(1000).optional() }).strict();
export const idSchema = z.string().uuid();
export const listSchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), quotationId: z.string().uuid().optional(), status: z.enum(['DRAFT','FINAL']).optional(), search: z.string().trim().max(100).optional() }).strict();
export const historySchema = listSchema.pick({ page: true, limit: true });
