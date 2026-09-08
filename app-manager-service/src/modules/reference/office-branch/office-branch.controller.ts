import { Request, Response } from 'express';
import { CreateOfficeBranchInput, ListOfficeBranchesInput, UpdateOfficeBranchInput } from './office-branch.schemas.js';
import { officeBranchService } from './office-branch.service.js';

type OfficeBranchParams = { officeBranchId: string };

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};

export const officeBranchController = {
  async listOptions(req: Request, res: Response): Promise<void> {
    send(req, res, 200, 'Office branch options retrieved successfully', await officeBranchService.listOptions());
  },
  async list(req: Request, res: Response): Promise<void> {
    send(req, res, 200, 'Office branches retrieved successfully', await officeBranchService.list(res.locals.query as ListOfficeBranchesInput));
  },
  async get(req: Request, res: Response): Promise<void> {
    send(req, res, 200, 'Office branch retrieved successfully', await officeBranchService.get((res.locals.params as OfficeBranchParams).officeBranchId));
  },
  async create(req: Request, res: Response): Promise<void> {
    send(req, res, 201, 'Office branch created successfully', await officeBranchService.create(res.locals.body as CreateOfficeBranchInput));
  },
  async update(req: Request, res: Response): Promise<void> {
    send(req, res, 200, 'Office branch updated successfully', await officeBranchService.update(
      (res.locals.params as OfficeBranchParams).officeBranchId,
      res.locals.body as UpdateOfficeBranchInput,
    ));
  },
  async delete(req: Request, res: Response): Promise<void> {
    send(req, res, 200, 'Office branch deleted successfully', await officeBranchService.delete((res.locals.params as OfficeBranchParams).officeBranchId));
  },
};
