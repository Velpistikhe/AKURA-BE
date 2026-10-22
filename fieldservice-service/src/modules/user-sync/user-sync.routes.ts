import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { applyFieldServiceUserSyncEvent } from './user-sync.repository.js';

const router = Router();
/**
 * Receives user snapshots from Auth through the API Gateway. The gateway
 * injects the Field Service gateway secret and requires Auth service
 * credentials; this handler additionally verifies the shared sync secret.
 * Only active FIELD_SERVICE users with an assigned branch are stored.
 */
router.post('/internal/users/events', asyncHandler(async (req, res) => {
  const supplied = req.headers['x-user-sync-secret'];
  const expected = env.USER_SYNC_SECRET;
  if (!expected || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    // The response envelope matches every other Field Service error so the
    // delivery monitor can read the same fields for every rejected layer.
    res.status(403).json({
      status: 403,
      success: false,
      message: 'Invalid user sync delivery credentials',
      requestId: req.headers['x-request-id'],
    });
    return;
  }
  res.json(await applyFieldServiceUserSyncEvent(req.body));
}));
export default router;