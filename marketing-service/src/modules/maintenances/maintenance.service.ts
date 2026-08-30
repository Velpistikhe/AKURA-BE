import { HttpError } from '../../utils/httpError.js';
import { CreateMaintenanceInput, CreateMaintenanceScopeInput, ListMaintenancesInput } from './maintenance.schemas.js';
import { maintenanceRepository } from './maintenance.repository.js';

export const maintenanceService = {
  list: (input: ListMaintenancesInput) => maintenanceRepository.list(input),
  async get(id: string) {
    const maintenance = await maintenanceRepository.findById(id);
    if (!maintenance) throw new HttpError('Maintenance not found', 404);
    return maintenance;
  },
  async create(data: CreateMaintenanceInput) {
    return maintenanceRepository.create(data);
  },
  async createScope(maintenanceId: string, data: CreateMaintenanceScopeInput) {
    if (!await maintenanceRepository.findById(maintenanceId)) throw new HttpError('Maintenance not found', 404);
    const existing = await maintenanceRepository.findScopeByName(maintenanceId, data.scope);
    if (existing && !existing.revoked) throw new HttpError(`Maintenance scope '${data.scope}' already exists`, 409);
    return maintenanceRepository.createScope(maintenanceId, data.scope);
  },
  async deleteScope(maintenanceId: string, scopeId: string) {
    const scope = await maintenanceRepository.revokeScope(maintenanceId, scopeId);
    if (!scope) throw new HttpError('Maintenance scope not found', 404);
    return scope;
  },
};
