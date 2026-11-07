import { Request, Response } from 'express';
import { getAuthenticatedActor, getAuthenticatedActorContext } from '../../utils/authenticatedUser.js';
import { ListUsersInput, UpdateUserInput } from './user-management.schemas.js';
import { userManagementService } from './user-management.service.js';

const send = (req: Request, res: Response, message: string, data: unknown): void => {
  res.status(200).json({ status: 200, success: true, message, data, requestId: req.headers['x-request-id'] });
};

export const userManagementController = {
  async list(req: Request, res: Response) {
    // The visibility scope follows the role of the caller: an app manager reads
    // every user of every branch, any other caller reads only the active users
    // of their own branch.
    const actor = getAuthenticatedActorContext(req);
    const scope = { isAppManager: actor.role === 'APP_MANAGER', officeBranchId: actor.officeBranchId };
    send(req, res, 'Users retrieved successfully', await userManagementService.list(
      res.locals.query as ListUsersInput,
      scope,
    ));
  },
  async get(req: Request, res: Response) { send(req, res, 'User retrieved successfully', await userManagementService.get((res.locals.params as { userId: string }).userId)); },
  async update(req: Request, res: Response) {
    send(req, res, 'User updated successfully', await userManagementService.update(
      getAuthenticatedActor(req),
      (res.locals.params as { userId: string }).userId,
      res.locals.body as UpdateUserInput,
    ));
  },
};
