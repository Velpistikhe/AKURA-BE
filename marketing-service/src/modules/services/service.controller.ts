import { Request, Response } from 'express';
import { CreateServiceInput, CreateServiceScopeInput, ListServicesInput, UpdateServiceInput } from './service.schemas.js';
import { serviceService } from './service.service.js';
import { getOfficeBranchId } from '../../utils/officeBranch.js';

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};
export const serviceController = {
  async list(req: Request, res: Response) { send(req, res, 200, 'Services retrieved successfully', await serviceService.list(res.locals.query as ListServicesInput, getOfficeBranchId(res))); },
  async get(req: Request, res: Response) {
    send(req, res, 200, 'Service retrieved successfully', await serviceService.get((res.locals.params as { serviceId: string }).serviceId, getOfficeBranchId(res)));
  },
  async create(req: Request, res: Response) { send(req, res, 201, 'Service created successfully', await serviceService.create(res.locals.body as CreateServiceInput, getOfficeBranchId(res))); },
  async update(req: Request, res: Response) { send(req, res, 200, 'Service updated successfully', await serviceService.update((res.locals.params as { serviceId: string }).serviceId, res.locals.body as UpdateServiceInput, getOfficeBranchId(res))); },
  async createMaintenanceScope(req: Request, res: Response) {
    const { serviceId } = res.locals.params as { serviceId: string };
    send(req, res, 201, 'Maintenance scope created successfully', await serviceService.createMaintenanceScope(serviceId, res.locals.body as CreateServiceScopeInput, getOfficeBranchId(res)));
  },
  async deleteMaintenanceScope(req: Request, res: Response) {
    const params = res.locals.params as { serviceId: string; scopeId: string };
    send(req, res, 200, 'Maintenance scope deleted successfully', await serviceService.deleteMaintenanceScope(params.serviceId, params.scopeId, getOfficeBranchId(res)));
  },
  async delete(req: Request, res: Response) { send(req, res, 200, 'Service deleted successfully', await serviceService.delete((res.locals.params as { serviceId: string }).serviceId, getOfficeBranchId(res))); },
  async createScope(req: Request, res: Response) {
    send(req, res, 201, 'Service scope created successfully', await serviceService.createScope(
      (res.locals.params as { serviceId: string }).serviceId,
      res.locals.body as CreateServiceScopeInput, getOfficeBranchId(res),
    ));
  },
  async deleteScope(req: Request, res: Response) {
    const params = res.locals.params as { serviceId: string; scopeId: string };
    send(req, res, 200, 'Service scope deleted successfully', await serviceService.deleteScope(params.serviceId, params.scopeId, getOfficeBranchId(res)));
  },
};
