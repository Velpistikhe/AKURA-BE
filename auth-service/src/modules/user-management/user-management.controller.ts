import { Request, Response } from 'express';
import { getAuthenticatedUserId } from '../../utils/authenticatedUser.js';
import { ListUsersInput, SetRoleInput, SetSectionInput, SetStatusInput } from './user-management.schemas.js';
import { userManagementService } from './user-management.service.js';

const send = (req: Request, res: Response, message: string, data: unknown): void => {
  res.status(200).json({ status: 200, success: true, message, data, requestId: req.headers['x-request-id'] });
};

export const userManagementController = {
  async list(req: Request, res: Response) { send(req, res, 'Users retrieved successfully', await userManagementService.list(res.locals.query as ListUsersInput)); },
  async get(req: Request, res: Response) { send(req, res, 'User retrieved successfully', await userManagementService.get((res.locals.params as { userId: string }).userId)); },
  async setRole(req: Request, res: Response) {
    const body = res.locals.body as SetRoleInput;
    send(req, res, 'User role updated successfully', await userManagementService.setRole(getAuthenticatedUserId(req), (res.locals.params as { userId: string }).userId, body.role, body.version));
  },
  async setSection(req: Request, res: Response) {
    const body = res.locals.body as SetSectionInput;
    send(req, res, 'User section updated successfully', await userManagementService.setSection(getAuthenticatedUserId(req), (res.locals.params as { userId: string }).userId, body.section, body.version));
  },
  async setStatus(req: Request, res: Response) {
    const body = res.locals.body as SetStatusInput;
    send(req, res, 'User status updated successfully', await userManagementService.setStatus(getAuthenticatedUserId(req), (res.locals.params as { userId: string }).userId, body.isActive, body.version));
  },
};
