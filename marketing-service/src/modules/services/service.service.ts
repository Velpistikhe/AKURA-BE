import { HttpError } from '../../utils/httpError.js';
import { CreateServiceInput, CreateServiceScopeInput, ListServicesInput, UpdateServiceInput } from './service.schemas.js';
import { serviceRepository } from './service.repository.js';

export const serviceService = {
  list: (input: ListServicesInput, officeBranchId: string) => serviceRepository.list(input, officeBranchId),
  async get(id: string, officeBranchId: string) {
    const service = await serviceRepository.findActiveById(id, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    return service;
  },
  async create(data: CreateServiceInput, officeBranchId: string) {
    return serviceRepository.create(data, officeBranchId);
  },
  async update(id: string, data: UpdateServiceInput, officeBranchId: string) {
    const current = await serviceRepository.findById(id, officeBranchId);
    if (!current) throw new HttpError('Service not found', 404);
    const hasMaintenance = data.hasMaintenance ?? current.hasMaintenance;
    if (!hasMaintenance && data.maintenanceScopes && data.maintenanceScopes.length > 0) {
      throw new HttpError('Maintenance scopes require hasMaintenance to be true', 400);
    }
    if (hasMaintenance && data.maintenanceScopes !== undefined && data.maintenanceScopes.length === 0) {
      throw new HttpError('At least one maintenance scope is required when maintenance is enabled', 400);
    }
    return serviceRepository.update(id, officeBranchId, data);
  },
  async createMaintenanceScope(serviceId: string, data: CreateServiceScopeInput, officeBranchId: string) {
    const service = await serviceRepository.findById(serviceId, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is inactive', 409);
    if (!service.hasMaintenance) throw new HttpError('Service does not provide maintenance', 409);
    const existing = await serviceRepository.findMaintenanceScopeByName(serviceId, data.scope, officeBranchId);
    if (existing && !existing.revoked) throw new HttpError(`Maintenance scope '${data.scope}' already exists`, 409);
    const scope = await serviceRepository.createMaintenanceScope(serviceId, data.scope, officeBranchId);
    if (!scope) throw new HttpError('Service is inactive or does not provide maintenance', 409);
    return scope;
  },
  async deleteMaintenanceScope(serviceId: string, scopeId: string, officeBranchId: string) {
    const service = await serviceRepository.findById(serviceId, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is inactive', 409);
    if (!service.hasMaintenance) throw new HttpError('Service does not provide maintenance', 409);
    const scope = await serviceRepository.revokeMaintenanceScope(serviceId, scopeId, officeBranchId);
    if (!scope) throw new HttpError('Maintenance scope not found', 404);
    return scope;
  },
  async delete(id: string, officeBranchId: string) {
    const service = await serviceRepository.findById(id, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is already inactive', 409);
    return serviceRepository.deactivate(id, officeBranchId);
  },
  async createScope(serviceId: string, data: CreateServiceScopeInput, officeBranchId: string) {
    if (!await serviceRepository.findById(serviceId, officeBranchId)) throw new HttpError('Service not found', 404);
    const existing = await serviceRepository.findScopeByName(serviceId, data.scope, officeBranchId);
    if (existing && !existing.revoked) throw new HttpError(`Service scope '${data.scope}' already exists`, 409);
    const scope = await serviceRepository.createScope(serviceId, data.scope, officeBranchId);
    if (!scope) throw new HttpError('Service is inactive', 409);
    return scope;
  },
  async deleteScope(serviceId: string, scopeId: string, officeBranchId: string) {
    const service = await serviceRepository.findById(serviceId, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is inactive', 409);
    const scope = await serviceRepository.revokeScope(serviceId, scopeId, officeBranchId);
    if (!scope) throw new HttpError('Service scope not found', 404);
    return scope;
  },
};
