import { Request, Response } from 'express';
import { CreateMenuAccessInput, ListMenuAccessesInput, UpdateMenuAccessInput } from './menu-access.schemas.js';
import { menuAccessService } from './menu-access.service.js';

type MenuAccessParams = { menuAccessId: string };

export const menuAccessController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await menuAccessService.list(res.locals.query as ListMenuAccessesInput);
    res.status(200).json({ status: 200, success: true, message: 'Menu accesses retrieved successfully', data: result, requestId: req.headers['x-request-id'] });
  },

  async get(req: Request, res: Response): Promise<void> {
    const access = await menuAccessService.get((res.locals.params as MenuAccessParams).menuAccessId);
    res.status(200).json({ status: 200, success: true, message: 'Menu access retrieved successfully', data: access, requestId: req.headers['x-request-id'] });
  },

  async create(req: Request, res: Response): Promise<void> {
    const access = await menuAccessService.create(res.locals.body as CreateMenuAccessInput);
    res.status(201).json({ status: 201, success: true, message: 'Menu access created successfully', data: access, requestId: req.headers['x-request-id'] });
  },

  async update(req: Request, res: Response): Promise<void> {
    const access = await menuAccessService.update((res.locals.params as MenuAccessParams).menuAccessId, res.locals.body as UpdateMenuAccessInput);
    res.status(200).json({ status: 200, success: true, message: 'Menu access updated successfully', data: access, requestId: req.headers['x-request-id'] });
  },

  async delete(req: Request, res: Response): Promise<void> {
    const access = await menuAccessService.delete((res.locals.params as MenuAccessParams).menuAccessId);
    res.status(200).json({ status: 200, success: true, message: 'Menu access deleted successfully', data: access, requestId: req.headers['x-request-id'] });
  },
};
