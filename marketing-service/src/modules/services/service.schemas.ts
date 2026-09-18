import { z } from 'zod';
import { ServiceType } from '@prisma/client';
import { SERVICE_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';
import { versionSchema } from '../items/item.schemas.js';

const fields = {
  type: z.nativeEnum(ServiceType),
  name: z.string().trim().min(1).max(200).transform(value => value.normalize('NFKC').replace(/\s+/g, ' ').trim()),
};
const inspectionScopeList = z.array(z.string().trim().min(1).max(500)).max(100)
  .refine((values) => new Set(values).size === values.length, 'Inspection scopes must be unique');

const maintenanceScopeList = z.array(z.string().trim().min(1).max(500)).max(100)
  .refine((values) => new Set(values).size === values.length, 'Maintenance scopes must be unique');

export const serviceIdSchema = z.object({ serviceId: z.string().uuid() });
export const maintenanceScopeIdSchema = z.object({
  serviceId: z.string().uuid(),
  scopeId: z.string().uuid(),
}).strict();
export const listServicesSchema = z.object({
  ...createListQueryFields(SERVICE_LIST_CONFIG),
  ...SERVICE_LIST_CONFIG.filterFields,
}).strict();
export const createServiceSchema = z.object({
  ...fields,
  inspectionScopes: inspectionScopeList.optional().default([]),
  hasMaintenance: z.boolean(),
  maintenanceScopes: maintenanceScopeList.optional().default([]),
}).strict().superRefine((value, ctx) => {
  if (value.hasMaintenance && value.maintenanceScopes.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenanceScopes'], message: 'At least one maintenance scope is required when hasMaintenance is true' });
  }
  if (!value.hasMaintenance && value.maintenanceScopes.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['maintenanceScopes'], message: 'Maintenance scopes require hasMaintenance to be true' });
  }
});
export const createMaintenanceScopeSchema = z.object({
  scope: z.string().trim().min(1).max(500),
}).strict();
export const deactivateServiceSchema = versionSchema;
export const serviceHistorySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const updateServiceSchema = versionSchema.extend({
  type: fields.type.optional(),
  name: fields.name.optional(),
  hasMaintenance: z.boolean().optional(),
})
  .refine((value) => value.type !== undefined || value.name !== undefined || value.hasMaintenance !== undefined, 'At least one editable field is required')
;

export type ListServicesInput = z.infer<typeof listServicesSchema>;
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type CreateInspectionScopeInput = z.infer<typeof createInspectionScopeSchema>;
export type CreateMaintenanceScopeInput = z.infer<typeof createMaintenanceScopeSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const inspectionScopeIdSchema = z.object({ serviceId: z.string().uuid(), inspectionScopeId: z.string().uuid() }).strict();
export const createInspectionScopeSchema = z.object({ inspectionScope: z.string().trim().min(1).max(500) }).strict();
