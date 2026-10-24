import { NextFunction, Router, Request, RequestHandler, Response } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { getAuditActor, getOfficeBranchId, restrictListVisibility } from '../../utils/officeBranch.js';
import { versionSchema } from '../items/item.schemas.js';
import { contractIdSchema, contractHistoryQuerySchema, createContractSchema, listContractsSchema, reviseContractSchema, terminateContractSchema, updateContractSchema } from './contract.schemas.js';
import { contractRepository as repository } from './contract.repository.js';
import { contractExcelController, uploadContractWorkbook } from './contract-excel.controller.js';
import { importContractExcelSchema } from './contract-excel.schemas.js';
import { HttpError } from '../../utils/httpError.js';
import { formatContractDates } from '../../utils/dateOnly.js';
const router = Router();
const send = (req: Request, res: Response, data: unknown, status = 200) => {
  const payload = data && typeof data === 'object' && 'contractDate' in data
    ? formatContractDates(data as { contractDate: Date | string }) : data;
  res.status(status).json({ status, success: true, data: payload, requestId: req.headers['x-request-id'] });
};
const assertMarketingSection = (res: Response): void => {
  if (res.locals.authUser?.section !== 'MARKETING') throw new HttpError('Marketing section is required', 403);
};
const requireMarketingSection: RequestHandler = (_req: Request, res: Response, next: NextFunction) => {
  try {
    assertMarketingSection(res);
    next();
  } catch (error) {
    next(error);
  }
};
const requireMarketingAdmin = (res: Response) => {
  if (res.locals.authUser?.role !== 'ADMIN' || res.locals.authUser.section !== 'MARKETING') throw new HttpError('Marketing admin role is required', 403);
};

router.get('/', validate('query', listContractsSchema), asyncHandler(async (req, res) => { send(req, res, await repository.list(restrictListVisibility(res, res.locals.query), getOfficeBranchId(res))); }));
router.post('/', validate('body', createContractSchema), asyncHandler(async (req, res) => { assertMarketingSection(res); const role = res.locals.authUser?.role; if (role !== 'USER' && role !== 'ADMIN') throw new HttpError('USER or ADMIN role is required', 403); send(req, res, await repository.create(res.locals.body, getOfficeBranchId(res), getAuditActor(res), role === 'ADMIN'), 201); }));
router.post('/:contractId/prices/import', validate('params', contractIdSchema), requireMarketingSection, uploadContractWorkbook, validate('body', importContractExcelSchema), asyncHandler(contractExcelController.upload));
router.get('/:contractId', validate('params', contractIdSchema), asyncHandler(async (req, res) => { send(req, res, await repository.get(res.locals.params.contractId, getOfficeBranchId(res))); }));
router.get('/:contractId/history', validate('params', contractIdSchema), validate('query', contractHistoryQuerySchema), asyncHandler(async (req, res) => { send(req, res, await repository.history(res.locals.params.contractId, getOfficeBranchId(res), res.locals.query)); }));

router.post('/:contractId/submit', validate('params', contractIdSchema), validate('body', versionSchema), asyncHandler(async (req, res) => { assertMarketingSection(res); send(req, res, await repository.submit(res.locals.params.contractId, res.locals.body.version, getOfficeBranchId(res), getAuditActor(res))); }));
router.post('/:contractId/reject', validate('params', contractIdSchema), validate('body', versionSchema), asyncHandler(async (req, res) => { requireMarketingAdmin(res); send(req, res, await repository.reject(res.locals.params.contractId, res.locals.body.version, getOfficeBranchId(res), getAuditActor(res))); }));
router.post('/:contractId/approve', validate('params', contractIdSchema), validate('body', versionSchema), asyncHandler(async (req, res) => { requireMarketingAdmin(res); send(req, res, await repository.approve(res.locals.params.contractId, res.locals.body.version, getOfficeBranchId(res), getAuditActor(res))); }));

router.patch('/:contractId', validate('params', contractIdSchema), validate('body', updateContractSchema), asyncHandler(async (req, res) => { assertMarketingSection(res); const isAdmin = res.locals.authUser?.role === 'ADMIN'; send(req, res, await repository.update(res.locals.params.contractId, res.locals.body, getOfficeBranchId(res), getAuditActor(res), isAdmin)); }));
router.post('/:contractId/revise', validate('params', contractIdSchema), validate('body', reviseContractSchema), asyncHandler(async (req, res) => { assertMarketingSection(res); send(req, res, await repository.revise(res.locals.params.contractId, res.locals.body, getOfficeBranchId(res), getAuditActor(res)), 201); }));
router.post('/:contractId/terminate', validate('params', contractIdSchema), validate('body', terminateContractSchema), asyncHandler(async (req, res) => { requireMarketingAdmin(res); send(req, res, await repository.terminate(res.locals.params.contractId, res.locals.body.version, res.locals.body.terminatedAt, getOfficeBranchId(res), getAuditActor(res))); }));
router.delete('/:contractId', validate('params', contractIdSchema), validate('body', versionSchema), asyncHandler(async (req, res) => { assertMarketingSection(res); send(req, res, await repository.delete(res.locals.params.contractId, res.locals.body.version, getOfficeBranchId(res), getAuditActor(res))); }));
export default router;
