import { Request, Response } from 'express';
import { CreateMenuItemInput, ListMenuItemsInput, UpdateMenuItemInput } from './menu-item.schemas.js';
import { menuItemService } from './menu-item.service.js';

type MenuItemParams = { menuItemId: string };

export const menuItemController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await menuItemService.list(res.locals.query as ListMenuItemsInput);
    res.status(200).json({ status: 200, success: true, message: 'Menu items retrieved successfully', data: result, requestId: req.headers['x-request-id'] });
  },

  async get(req: Request, res: Response): Promise<void> {
    const item = await menuItemService.get((res.locals.params as MenuItemParams).menuItemId);
    res.status(200).json({ status: 200, success: true, message: 'Menu item retrieved successfully', data: item, requestId: req.headers['x-request-id'] });
  },

  async create(req: Request, res: Response): Promise<void> {
    const item = await menuItemService.create(res.locals.body as CreateMenuItemInput);
    res.status(201).json({ status: 201, success: true, message: 'Menu item created successfully', data: item, requestId: req.headers['x-request-id'] });
  },

  async update(req: Request, res: Response): Promise<void> {
    const item = await menuItemService.update((res.locals.params as MenuItemParams).menuItemId, res.locals.body as UpdateMenuItemInput);
    res.status(200).json({ status: 200, success: true, message: 'Menu item updated successfully', data: item, requestId: req.headers['x-request-id'] });
  },

  async delete(req: Request, res: Response): Promise<void> {
    const item = await menuItemService.delete((res.locals.params as MenuItemParams).menuItemId);
    res.status(200).json({ status: 200, success: true, message: 'Menu item deleted successfully', data: item, requestId: req.headers['x-request-id'] });
  },
};
