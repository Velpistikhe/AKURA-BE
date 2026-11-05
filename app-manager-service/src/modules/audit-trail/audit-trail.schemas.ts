import { z } from 'zod';
import { createListQueryFields } from '../../utils/listQuery.js';

/** The audit trail of one entity is read by its identifier. */
export const auditTrailEntitySchema = z.object({
  entityId: z.string().uuid('Invalid entity ID'),
}).strict();

/** The audit trail can be filtered by module, entity and action. */
export const AUDIT_TRAIL_LIST_CONFIG = {
  sortFields: ['createdAt', 'module', 'entityType', 'action'] as const,
  pagination: { defaultPage: 1, defaultLimit: 50, maxLimit: 200 },
  filterFields: {
    module: z.enum(['menu', 'reference']).optional(),
    entityType: z.enum(['MENU', 'MENU_ITEM', 'MENU_ACCESS', 'OFFICE_BRANCH']).optional(),
    entityId: z.string().uuid('Invalid entity ID').optional(),
    action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'DEACTIVATE', 'ACTIVATE']).optional(),
  },
};

export const listAuditTrailSchema = z.object({
  ...createListQueryFields(AUDIT_TRAIL_LIST_CONFIG),
  ...AUDIT_TRAIL_LIST_CONFIG.filterFields,
}).strict();

export type ListAuditTrailInput = z.infer<typeof listAuditTrailSchema>;
