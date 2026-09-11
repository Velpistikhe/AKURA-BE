import { Request, Response } from 'express';
import { CreateServiceInput, CreateInspectionScopeInput, CreateMaintenanceScopeInput, ListServicesInput, UpdateServiceInput } from './service.schemas.js';
import { serviceService } from './service.service.js';
import { getAuditActor, getOfficeBranchId } from '../../utils/officeBranch.js';

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};
export const serviceController = {
  async list(req: Request, res: Response) { send(req, res, 200, 'Services retrieved successfully', await serviceService.list(res.locals.query as ListServicesInput, getOfficeBranchId(res))); },
  async history(req: Request, res: Response) { send(req, res, 200, 'Service history retrieved successfully', await serviceService.history((res.locals.params as { serviceId: string }).serviceId, getOfficeBranchId(res), res.locals.query)); },
  async get(req: Request, res: Response) {
    send(req, res, 200, 'Service retrieved successfully', await serviceService.get((res.locals.params as { serviceId: string }).serviceId, getOfficeBranchId(res)));
  },
  async create(req: Request, res: Response) { send(req, res, 201, 'Service created successfully', await serviceService.create(res.locals.body as CreateServiceInput, getOfficeBranchId(res), getAuditActor(res))); },
  async update(req: Request, res: Response) { send(req, res, 200, 'Service updated successfully', await serviceService.update((res.locals.params as { serviceId: string }).serviceId, res.locals.body as UpdateServiceInput, getOfficeBranchId(res), getAuditActor(res))); },
  async createMaintenanceScope(req: Request, res: Response) {
    const { serviceId } = res.locals.params as { serviceId: string };
    send(req, res, 201, 'Maintenance scope created successfully', await serviceService.createMaintenanceScope(serviceId, res.locals.body as CreateMaintenanceScopeInput, getOfficeBranchId(res), getAuditActor(res)));
  },
  async deleteMaintenanceScope(req: Request, res: Response) {
    const params = res.locals.params as { serviceId: string; scopeId: string };
    send(req, res, 200, 'Maintenance scope deleted successfully', await serviceService.deleteMaintenanceScope(params.serviceId, params.scopeId, getOfficeBranchId(res), getAuditActor(res)));
  },
  async delete(req: Request, res: Response) { send(req, res, 200, 'Service deleted successfully', await serviceService.delete((res.locals.params as { serviceId: string }).serviceId, res.locals.body.version, getOfficeBranchId(res), getAuditActor(res))); },
  async createInspectionScope(req: Request, res: Response) {
    send(req, res, 201, 'Inspection scope created successfully', await serviceService.createInspectionScope(
      (res.locals.params as { serviceId: string }).serviceId,
      res.locals.body as CreateInspectionScopeInput, getOfficeBranchId(res), getAuditActor(res),
    ));
  },
  async deleteInspectionScope(req: Request, res: Response) {
    const params = res.locals.params as { serviceId: string; inspectionScopeId: string };
    send(req, res, 200, 'Inspection scope deleted successfully', await serviceService.deleteInspectionScope(params.serviceId, params.inspectionScopeId, getOfficeBranchId(res), getAuditActor(res)));
  },
};
