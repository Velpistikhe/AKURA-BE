import { Request, Response } from 'express';
import { companyStaffService } from './company-staff.service.js';
import { CreateCompanyStaffInput, ListCompanyStaffInput, UpdateCompanyStaffInput } from './company-staff.schemas.js';

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};
export const companyStaffController = {
  async list(req: Request, res: Response) { send(req, res, 200, 'Company staff retrieved successfully', await companyStaffService.list(res.locals.query as ListCompanyStaffInput)); },
  async get(req: Request, res: Response) { send(req, res, 200, 'Company staff retrieved successfully', await companyStaffService.get((res.locals.params as { companyStaffId: string }).companyStaffId)); },
  async create(req: Request, res: Response) { send(req, res, 201, 'Company staff created successfully', await companyStaffService.create(res.locals.body as CreateCompanyStaffInput)); },
  async update(req: Request, res: Response) { send(req, res, 200, 'Company staff updated successfully', await companyStaffService.update((res.locals.params as { companyStaffId: string }).companyStaffId, res.locals.body as UpdateCompanyStaffInput)); },
  async delete(req: Request, res: Response) { send(req, res, 200, 'Company staff deleted successfully', await companyStaffService.delete((res.locals.params as { companyStaffId: string }).companyStaffId)); },
};
