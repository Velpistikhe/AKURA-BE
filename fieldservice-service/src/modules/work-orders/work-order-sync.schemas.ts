import { z } from 'zod';

/**
 * Query parameters of the Work Order synchronisation history.
 *
 * The endpoint returns the recorded deliveries of one Work Order, so the page
 * size is bounded like every other list endpoint in this service.
 */
export const workOrderSyncQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type WorkOrderSyncQuery = z.infer<typeof workOrderSyncQuerySchema>;