import { Request, Response } from 'express';
import { itemList, itemService } from './item.service.js';
import { getOfficeBranchId } from '../../utils/officeBranch.js';

const send = (req: Request, res: Response, status: number, data: unknown): void => {
  res.status(status).json({ status, success: true, data, requestId: req.headers['x-request-id'] });
};

export const listItems = async (req: Request, res: Response): Promise<void> => {
  send(req, res, 200, await itemList(res.locals.query, getOfficeBranchId(res)));
};

export const itemController = {
  create: async (req: Request, res: Response): Promise<void> => {
    send(req, res, 201, await itemService.create(res.locals.body, getOfficeBranchId(res)));
  },
  get: async (req: Request, res: Response): Promise<void> => {
    send(req, res, 200, await itemService.get(res.locals.params.itemId, getOfficeBranchId(res)));
  },
  update: async (req: Request, res: Response): Promise<void> => {
    send(req, res, 200, await itemService.update(res.locals.params.itemId, res.locals.body, getOfficeBranchId(res)));
  },
  remove: async (req: Request, res: Response): Promise<void> => {
    send(req, res, 200, await itemService.remove(res.locals.params.itemId, getOfficeBranchId(res)));
  },
};
