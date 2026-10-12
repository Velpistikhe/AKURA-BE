import { Request, Response } from 'express';
import { getAuthenticatedActor, getAuthenticatedUserId } from '../../utils/authenticatedUser.js';
import { ListUsersInput, ListUserSyncDeliveriesInput, UpdateUserInput } from './user-management.schemas.js';
import { userManagementService } from './user-management.service.js';
import { listUserSyncDeliveries } from '../user-sync/user-sync.service.js';
import { processDueUserSyncs } from '../user-sync/user-sync.delivery.js';

const send = (req: Request, res: Response, message: string, data: unknown): void => {
  res.status(200).json({ status: 200, success: true, message, data, requestId: req.headers['x-request-id'] });
};

export const userManagementController = {
  async list(req: Request, res: Response) { send(req, res, 'Users retrieved successfully', await userManagementService.list(res.locals.query as ListUsersInput)); },
  async get(req: Request, res: Response) { send(req, res, 'User retrieved successfully', await userManagementService.get((res.locals.params as { userId: string }).userId)); },
  async inspectors(req: Request, res: Response) {
    const { ids } = res.locals.query as { ids: string[] };
    send(req, res, 'Field Service inspectors validated successfully', await userManagementService.inspectors(getAuthenticatedUserId(req), ids));
  },
  async update(req: Request, res: Response) {
    send(req, res, 'User updated successfully', await userManagementService.update(
      getAuthenticatedActor(req),
      (res.locals.params as { userId: string }).userId,
      res.locals.body as UpdateUserInput,
    ));
  },
  async syncDeliveries(req: Request, res: Response) {
    // Push up to five due retries before reading so the monitoring view shows
    // current state even when the timer worker is not running (mirrors the
    // Finance tax deliveries endpoint). Never blocks the read on failure.
    await processDueUserSyncs();
    send(req, res, 'User sync deliveries retrieved successfully', await listUserSyncDeliveries(res.locals.query as ListUserSyncDeliveriesInput));
  },
};
