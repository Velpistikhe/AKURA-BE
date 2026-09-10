import { Request, Response } from 'express';
import { companyService } from './company.service.js';
import { CreateCompanyInput, ListCompaniesInput, UpdateCompanyInput } from './company.schemas.js';
import { getAuditActor, getOfficeBranchId } from '../../utils/officeBranch.js';

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};
export const companyController = {
  async list(req: Request, res: Response) { send(req, res, 200, 'Companies retrieved successfully', await companyService.list(res.locals.query as ListCompaniesInput, getOfficeBranchId(res))); },
  async get(req: Request, res: Response) { send(req, res, 200, 'Company retrieved successfully', await companyService.get((res.locals.params as { companyId: string }).companyId, getOfficeBranchId(res))); },
  async create(req: Request, res: Response) { send(req, res, 201, 'Company created successfully', await companyService.create(res.locals.body as CreateCompanyInput, getOfficeBranchId(res), getAuditActor(res))); },
  async update(req: Request, res: Response) { send(req, res, 200, 'Company updated successfully', await companyService.update((res.locals.params as { companyId: string }).companyId, res.locals.body as UpdateCompanyInput, getOfficeBranchId(res), getAuditActor(res))); },
  async delete(req: Request, res: Response) { send(req, res, 200, 'Company deleted successfully', await companyService.delete((res.locals.params as { companyId: string }).companyId, getOfficeBranchId(res), res.locals.body.version, getAuditActor(res))); },
};
