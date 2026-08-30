import { Request, Response } from 'express';
import { AuthUser } from '../../middlewares/authorize.middleware.js';
import { CreateMenuInput, ListMenusInput, UpdateMenuInput } from './menu.schemas.js';
import { menuService } from './menu.service.js';

type MenuParams = { menuId: string };

export const menuController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await menuService.list(res.locals.query as ListMenusInput);
    res.status(200).json({ status: 200, success: true, message: 'Menus retrieved successfully', data: result, requestId: req.headers['x-request-id'] });
  },

  async get(req: Request, res: Response): Promise<void> {
    const menu = await menuService.get((res.locals.params as MenuParams).menuId);
    res.status(200).json({ status: 200, success: true, message: 'Menu retrieved successfully', data: menu, requestId: req.headers['x-request-id'] });
  },

  async create(req: Request, res: Response): Promise<void> {
    const menu = await menuService.create(res.locals.body as CreateMenuInput);
    res.status(201).json({ status: 201, success: true, message: 'Menu created successfully', data: menu, requestId: req.headers['x-request-id'] });
  },

  async update(req: Request, res: Response): Promise<void> {
    const menu = await menuService.update((res.locals.params as MenuParams).menuId, res.locals.body as UpdateMenuInput);
    res.status(200).json({ status: 200, success: true, message: 'Menu updated successfully', data: menu, requestId: req.headers['x-request-id'] });
  },

  async delete(req: Request, res: Response): Promise<void> {
    const menu = await menuService.delete((res.locals.params as MenuParams).menuId);
    res.status(200).json({ status: 200, success: true, message: 'Menu deleted successfully', data: menu, requestId: req.headers['x-request-id'] });
  },

  async getMyMenus(req: Request, res: Response): Promise<void> {
    const { role, section } = res.locals.authUser as AuthUser;
    const menus = await menuService.getMenusForUser(role, section);
    res.status(200).json({
      status: 200,
      success: true,
      message: 'Menus retrieved successfully',
      data: menus,
      requestId: req.headers['x-request-id'],
    });
  },
};
