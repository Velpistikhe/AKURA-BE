import { Request, Response } from 'express';
import { getAuthenticatedActor, getAuthenticatedUserId } from '../../utils/authenticatedUser.js';
import { ListUsersInput, UpdateUserInput } from './user-management.schemas.js';
import { userManagementService } from './user-management.service.js';

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
};
