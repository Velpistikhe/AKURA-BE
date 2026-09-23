import { Request, Response } from 'express';
import { prisma } from '../../config/db.js';
import { getOfficeBranchId, getAuditActor } from '../../utils/officeBranch.js';
import { HttpError } from '../../utils/httpError.js';
import { itemWriteRepository as writes } from './item-write.repository.js';
import { itemRepository } from './item.repository.js';
import { itemHistoryRepository } from './item-history.repository.js';

const send = (req: Request, res: Response, data: unknown, status = 200) => {
  res.status(status).json({ status, success: true, data, requestId: req.headers['x-request-id'] });
};

export const itemPriceController = {
  itemHistory: async (req: Request, res: Response) => { send(req, res, await itemHistoryRepository.read('ITEM', res.locals.params.itemId, getOfficeBranchId(res), res.locals.query)); },
  sizeHistory: async (req: Request, res: Response) => { send(req, res, await itemHistoryRepository.read('ITEM_SIZE', res.locals.params.itemSizeId, getOfficeBranchId(res), res.locals.query)); },
  priceHistory: async (req: Request, res: Response) => { send(req, res, await itemHistoryRepository.read('ITEM_PRICE', res.locals.params.itemSizeId, getOfficeBranchId(res), res.locals.query)); },
  resolvedPrices: async (req: Request, res: Response) => {
    const branch = getOfficeBranchId(res);
    send(req, res, await itemRepository.listSizes(res.locals.query, branch, res.locals.query.companyId, true));
  },
  contractPriceOptions: async (req: Request, res: Response) => {
    const branch = getOfficeBranchId(res);
    send(req, res, await itemRepository.listContractPriceOptions(res.locals.query, res.locals.params.contractId, branch));
  },
  updateItem: async (req: Request, res: Response) => { send(req, res, await writes.updateItem(res.locals.params.itemId, res.locals.body, getOfficeBranchId(res), getAuditActor(res))); },
  createPrice: async (req: Request, res: Response) => { send(req, res, await writes.savePrice(res.locals.params.itemSizeId, res.locals.body, getOfficeBranchId(res), getAuditActor(res), true), 201); },
  updatePrice: async (req: Request, res: Response) => { send(req, res, await writes.savePrice(res.locals.params.itemSizeId, res.locals.body, getOfficeBranchId(res), getAuditActor(res))); },
  createContract: async (req: Request, res: Response) => { send(req, res, await writes.createContract(res.locals.params.itemSizeId, res.locals.body, getOfficeBranchId(res), getAuditActor(res)), 201); },
  updateContract: async (req: Request, res: Response) => { send(req, res, await writes.changeContract(res.locals.params.contractPriceId, res.locals.body, getOfficeBranchId(res), getAuditActor(res))); },
  removeContract: async (req: Request, res: Response) => { send(req, res, await writes.changeContract(res.locals.params.contractPriceId, res.locals.body, getOfficeBranchId(res), getAuditActor(res), true)); },
  getSize: async (req: Request, res: Response) => {
    const branch = getOfficeBranchId(res);
    const size = await prisma.itemSize.findFirst({ where: { id: res.locals.params.itemSizeId, item: { officeBranchId: branch } }, include: { price: true, item: { include: { service: true } } } });
    if (!size) throw new HttpError('Item size not found', 404);
    send(req, res, size);
  },
};
