import { Request, Response } from 'express';
import { itemList, itemService } from './item.service.js';

const send = (req: Request, res: Response, status: number, data: unknown): void => {
  res.status(status).json({ status, success: true, data, requestId: req.headers['x-request-id'] });
};

export const listItems = async (req: Request, res: Response): Promise<void> => {
  send(req, res, 200, await itemList(res.locals.query));
};

export const itemController = {
  create: async (req: Request, res: Response): Promise<void> => {
    send(req, res, 201, await itemService.create(res.locals.body));
  },
  get: async (req: Request, res: Response): Promise<void> => {
    send(req, res, 200, await itemService.get(res.locals.params.itemId));
  },
  update: async (req: Request, res: Response): Promise<void> => {
    send(req, res, 200, await itemService.update(res.locals.params.itemId, res.locals.body));
  },
  remove: async (req: Request, res: Response): Promise<void> => {
    send(req, res, 200, await itemService.remove(res.locals.params.itemId));
  },
};
