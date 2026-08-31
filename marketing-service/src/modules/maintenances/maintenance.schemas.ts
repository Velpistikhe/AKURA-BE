import { z } from 'zod';
import { MAINTENANCE_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

const scopes = z.array(z.string().trim().min(1).max(500)).max(100).default([])
  .refine((values) => new Set(values).size === values.length, 'Scopes must be unique');

export const maintenanceIdSchema = z.object({ maintenanceId: z.string().uuid() }).strict();
export const maintenanceScopeIdSchema = z.object({
  maintenanceId: z.string().uuid(),
  scopeId: z.string().uuid(),
}).strict();
export const listMaintenancesSchema = z.object({
  ...createListQueryFields(MAINTENANCE_LIST_CONFIG),
  ...MAINTENANCE_LIST_CONFIG.filterFields,
}).strict();
export const createMaintenanceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  scopes,
  isActive: z.boolean().optional().default(true),
}).strict();
export const createMaintenanceScopeSchema = z.object({
  scope: z.string().trim().min(1).max(500),
}).strict();

export type ListMaintenancesInput = z.infer<typeof listMaintenancesSchema>;
export type CreateMaintenanceInput = z.infer<typeof createMaintenanceSchema>;
export type CreateMaintenanceScopeInput = z.infer<typeof createMaintenanceScopeSchema>;
