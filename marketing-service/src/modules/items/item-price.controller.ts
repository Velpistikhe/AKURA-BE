import { Request, Response } from 'express';
import { prisma } from '../../config/db.js';
import { getOfficeBranchId, getAuditActor } from '../../utils/officeBranch.js';
import { HttpError } from '../../utils/httpError.js';
import { itemWriteRepository as writes } from './item-write.repository.js';
import { itemRepository } from './item.repository.js';
import { itemService } from './item.service.js';

const send = (req: Request, res: Response, data: unknown, status = 200) => {
  res.status(status).json({ status, success: true, data, requestId: req.headers['x-request-id'] });
};
export const itemPriceController = {
  resolvedPrices: async (req: Request, res: Response) => {
    const branch = getOfficeBranchId(res);
    await itemService.validateSizeListItem(res.locals.query, branch);
    send(req, res, await itemRepository.listSizes(res.locals.query, branch, res.locals.query.companyId, true));
  },
  updateItem: async (req: Request, res: Response) => { send(req, res, await writes.updateItem(res.locals.params.itemId, res.locals.body, getOfficeBranchId(res), getAuditActor(res))); },
  updateSize: async (req: Request, res: Response) => { send(req, res, await writes.updateSize(res.locals.params.itemSizeId, res.locals.body, getOfficeBranchId(res), getAuditActor(res))); },
  createPrice: async (req: Request, res: Response) => { send(req, res, await writes.savePrice(res.locals.params.itemSizeId, res.locals.body, getOfficeBranchId(res), getAuditActor(res), true), 201); },
  updatePrice: async (req: Request, res: Response) => { send(req, res, await writes.savePrice(res.locals.params.itemSizeId, res.locals.body, getOfficeBranchId(res), getAuditActor(res))); },
  removePrice: async (req: Request, res: Response) => { send(req, res, await writes.removePrice(res.locals.params.itemSizeId, res.locals.body.version, getOfficeBranchId(res), getAuditActor(res))); },
  createContract: async (req: Request, res: Response) => { send(req, res, await writes.createContract(res.locals.params.itemSizeId, res.locals.body, getOfficeBranchId(res), getAuditActor(res)), 201); },
  updateContract: async (req: Request, res: Response) => { send(req, res, await writes.changeContract(res.locals.params.contractPriceId, res.locals.body, getOfficeBranchId(res), getAuditActor(res))); },
  removeContract: async (req: Request, res: Response) => { send(req, res, await writes.changeContract(res.locals.params.contractPriceId, res.locals.body, getOfficeBranchId(res), getAuditActor(res), true)); },
  getPrice: async (req: Request, res: Response) => {
    const branch = getOfficeBranchId(res);
    const price = await prisma.itemPrice.findFirst({ where: { itemSizeId: res.locals.params.itemSizeId, itemSize: { item: { officeBranchId: branch, service: { officeBranchId: branch } } } } });
    if (!price) throw new HttpError('Item price not found', 404);
    send(req, res, price);
  },
  getSize: async (req: Request, res: Response) => {
    const branch = getOfficeBranchId(res);
    const size = await prisma.itemSize.findFirst({ where: { id: res.locals.params.itemSizeId, item: { officeBranchId: branch, service: { officeBranchId: branch } } }, include: { price: true, item: { include: { service: true } } } });
    if (!size) throw new HttpError('Item size not found', 404);
    send(req, res, size);
  },
  getContract: async (req: Request, res: Response) => {
    const branch = getOfficeBranchId(res);
    const price = await prisma.companyContractPrice.findFirst({ where: { id: res.locals.params.contractPriceId, contract: { company: { officeBranchId: branch, revoked: false } }, itemSize: { item: { officeBranchId: branch, service: { officeBranchId: branch } } } } });
    if (!price) throw new HttpError('Contract price not found', 404);
    send(req, res, price);
  },
  history: async (req: Request, res: Response) => {
    const { entityType, entityId, page, limit } = res.locals.query;
    const where = { officeBranchId: getOfficeBranchId(res), entityType, entityId };
    const [history, total] = await prisma.$transaction([
      prisma.catalogAuditLog.findMany({ where, orderBy: { version: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.catalogAuditLog.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    send(req, res, { history, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  },
};
