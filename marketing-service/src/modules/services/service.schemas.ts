import { z } from 'zod';
import { SERVICE_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

const fields = {
  code: z.string().trim().min(1).max(50).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(200),
};
const scopes = z.array(z.string().trim().min(1).max(500)).max(100).default([])
  .refine((values) => new Set(values).size === values.length, 'Scopes must be unique');

export const serviceIdSchema = z.object({ serviceId: z.string().uuid() });
export const serviceScopeIdSchema = z.object({
  serviceId: z.string().uuid(),
  scopeId: z.string().uuid(),
}).strict();
export const listServicesSchema = z.object({
  ...createListQueryFields(SERVICE_LIST_CONFIG),
  ...SERVICE_LIST_CONFIG.filterFields,
}).strict();
export const maintenanceInput = z.object({
  name: fields.name,
  scopes,
}).strict();
export const createServiceSchema = z.object({
  ...fields,
  scopes,
  hasService: z.boolean(),
  maintenance: maintenanceInput.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.hasService && !value.maintenance) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenance'], message: 'Maintenance is required when hasService is true' });
  }
});
export const createServiceMaintenanceSchema = maintenanceInput;
export const createServiceScopeSchema = z.object({
  scope: z.string().trim().min(1).max(500),
}).strict();
export const updateServiceSchema = z.object({
  code: fields.code.optional(), name: fields.name.optional(),
  isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export type ListServicesInput = z.infer<typeof listServicesSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type CreateServiceMaintenanceInput = z.infer<typeof createServiceMaintenanceSchema>;
export type CreateServiceScopeInput = z.infer<typeof createServiceScopeSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
