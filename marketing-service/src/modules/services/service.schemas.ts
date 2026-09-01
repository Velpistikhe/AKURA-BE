import { z } from 'zod';
import { SERVICE_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

const fields = {
  name: z.string().trim().min(1).max(200),
};
const scopeList = z.array(z.string().trim().min(1).max(500)).max(100)
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
export const createServiceSchema = z.object({
  ...fields,
  scopes: scopeList.optional().default([]),
  hasMaintenance: z.boolean(),
  maintenanceScopes: scopeList.optional().default([]),
}).strict().superRefine((value, ctx) => {
  if (value.hasMaintenance && value.maintenanceScopes.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenanceScopes'], message: 'At least one maintenance scope is required when hasMaintenance is true' });
  }
  if (!value.hasMaintenance && value.maintenanceScopes.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenanceScopes'], message: 'Maintenance scopes require hasMaintenance to be true' });
  }
});
export const createServiceScopeSchema = z.object({
  scope: z.string().trim().min(1).max(500),
}).strict();
export const updateServiceSchema = z.object({
  name: fields.name.optional(),
  hasMaintenance: z.boolean().optional(),
  isActive: z.boolean().optional(),
  scopes: scopeList.optional(),
  maintenanceScopes: scopeList.optional(),
}).strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required')
  .superRefine((value, ctx) => {
    if (value.hasMaintenance === true && (!value.maintenanceScopes || value.maintenanceScopes.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenanceScopes'], message: 'At least one maintenance scope is required when enabling maintenance' });
    }
    if (value.hasMaintenance === false && value.maintenanceScopes && value.maintenanceScopes.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenanceScopes'], message: 'Maintenance scopes cannot be provided when disabling maintenance' });
    }
  });

export type ListServicesInput = z.infer<typeof listServicesSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type CreateServiceScopeInput = z.infer<typeof createServiceScopeSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
