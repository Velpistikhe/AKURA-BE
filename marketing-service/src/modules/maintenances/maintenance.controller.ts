import { Request, Response } from 'express';
import { CreateMaintenanceInput, CreateMaintenanceScopeInput, ListMaintenancesInput } from './maintenance.schemas.js';
import { maintenanceService } from './maintenance.service.js';

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};

export const maintenanceController = {
  async list(req: Request, res: Response) {
    send(req, res, 200, 'Maintenances retrieved successfully', await maintenanceService.list(res.locals.query as ListMaintenancesInput));
  },
  async get(req: Request, res: Response) {
    send(req, res, 200, 'Maintenance retrieved successfully', await maintenanceService.get((res.locals.params as { maintenanceId: string }).maintenanceId));
  },
  async create(req: Request, res: Response) {
    send(req, res, 201, 'Maintenance created successfully', await maintenanceService.create(res.locals.body as CreateMaintenanceInput));
  },
  async createScope(req: Request, res: Response) {
    send(req, res, 201, 'Maintenance scope created successfully', await maintenanceService.createScope(
      (res.locals.params as { maintenanceId: string }).maintenanceId,
      res.locals.body as CreateMaintenanceScopeInput,
    ));
  },
  async deleteScope(req: Request, res: Response) {
    const params = res.locals.params as { maintenanceId: string; scopeId: string };
    send(req, res, 200, 'Maintenance scope deleted successfully', await maintenanceService.deleteScope(params.maintenanceId, params.scopeId));
  },
};
