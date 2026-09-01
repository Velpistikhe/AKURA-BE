import { HttpError } from '../../utils/httpError.js';
import { CreateServiceInput, CreateServiceScopeInput, ListServicesInput, UpdateServiceInput } from './service.schemas.js';
import { serviceRepository } from './service.repository.js';

export const serviceService = {
  list: (input: ListServicesInput) => serviceRepository.list(input),
  async get(id: string) {
    const service = await serviceRepository.findById(id);
    if (!service) throw new HttpError('Service not found', 404);
    return service;
  },
  async create(data: CreateServiceInput) {
    if (await serviceRepository.findByCode(data.code)) throw new HttpError(`Service code '${data.code}' already exists`, 409);
    return serviceRepository.create(data);
  },
  async update(id: string, data: UpdateServiceInput) {
    const current = await serviceRepository.findById(id);
    if (!current) throw new HttpError('Service not found', 404);
    if (data.code && data.code !== current.code && await serviceRepository.findByCode(data.code)) throw new HttpError(`Service code '${data.code}' already exists`, 409);
    const hasMaintenance = data.hasMaintenance ?? current.hasMaintenance;
    if (!hasMaintenance && data.maintenanceScopes && data.maintenanceScopes.length > 0) {
      throw new HttpError('Maintenance scopes require hasMaintenance to be true', 400);
    }
    if (hasMaintenance && data.maintenanceScopes !== undefined && data.maintenanceScopes.length === 0) {
      throw new HttpError('At least one maintenance scope is required when maintenance is enabled', 400);
    }
    return serviceRepository.update(id, data);
  },
  async createMaintenanceScope(serviceId: string, data: CreateServiceScopeInput) {
    const service = await serviceRepository.findById(serviceId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is inactive', 409);
    if (!service.hasMaintenance) throw new HttpError('Service does not provide maintenance', 409);
    const existing = await serviceRepository.findMaintenanceScopeByName(serviceId, data.scope);
    if (existing && !existing.revoked) throw new HttpError(`Maintenance scope '${data.scope}' already exists`, 409);
    const scope = await serviceRepository.createMaintenanceScope(serviceId, data.scope);
    if (!scope) throw new HttpError('Service is inactive or does not provide maintenance', 409);
    return scope;
  },
  async deleteMaintenanceScope(serviceId: string, scopeId: string) {
    const service = await serviceRepository.findById(serviceId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is inactive', 409);
    if (!service.hasMaintenance) throw new HttpError('Service does not provide maintenance', 409);
    const scope = await serviceRepository.revokeMaintenanceScope(serviceId, scopeId);
    if (!scope) throw new HttpError('Maintenance scope not found', 404);
    return scope;
  },
  async delete(id: string) {
    if (!await serviceRepository.findById(id)) throw new HttpError('Service not found', 404);
    return serviceRepository.deactivate(id);
  },
  async createScope(serviceId: string, data: CreateServiceScopeInput) {
    if (!await serviceRepository.findById(serviceId)) throw new HttpError('Service not found', 404);
    const existing = await serviceRepository.findScopeByName(serviceId, data.scope);
    if (existing && !existing.revoked) throw new HttpError(`Service scope '${data.scope}' already exists`, 409);
    const scope = await serviceRepository.createScope(serviceId, data.scope);
    if (!scope) throw new HttpError('Service is inactive', 409);
    return scope;
  },
  async deleteScope(serviceId: string, scopeId: string) {
    const service = await serviceRepository.findById(serviceId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is inactive', 409);
    const scope = await serviceRepository.revokeScope(serviceId, scopeId);
    if (!scope) throw new HttpError('Service scope not found', 404);
    return scope;
  },
};
