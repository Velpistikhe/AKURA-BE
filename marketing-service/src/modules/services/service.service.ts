import { HttpError } from '../../utils/httpError.js';
import { CreateServiceInput, CreateInspectionScopeInput, CreateMaintenanceScopeInput, ListServicesInput, UpdateServiceInput } from './service.schemas.js';
import { serviceRepository } from './service.repository.js';
import { AuditActor } from '../../types/auth.types.js';

export const serviceService = {
  list: (input: ListServicesInput, officeBranchId: string) => serviceRepository.list(input, officeBranchId),
  history: (id: string, officeBranchId: string, input: { page: number; limit: number }) => serviceRepository.history(id, officeBranchId, input),
  async get(id: string, officeBranchId: string) {
    const service = await serviceRepository.findById(id, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    return service;
  },
  async create(data: CreateServiceInput, officeBranchId: string, actor: AuditActor) {
    return serviceRepository.create(data, officeBranchId, actor);
  },
  async update(id: string, data: UpdateServiceInput, officeBranchId: string, actor: AuditActor) {
    const current = await serviceRepository.findById(id, officeBranchId);
    if (!current) throw new HttpError('Service not found', 404);
    return serviceRepository.update(id, officeBranchId, data, actor);
  },
  async createMaintenanceScope(serviceId: string, data: CreateMaintenanceScopeInput, officeBranchId: string, actor: AuditActor) {
    const service = await serviceRepository.findById(serviceId, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is inactive', 409);
    if (!service.hasMaintenance) throw new HttpError('Service does not provide maintenance', 409);
    const existing = await serviceRepository.findMaintenanceScopeByName(serviceId, data.scope, officeBranchId);
    if (existing && !existing.revoked) throw new HttpError(`Maintenance scope '${data.scope}' already exists`, 409);
    const scope = await serviceRepository.createMaintenanceScope(serviceId, data.scope, officeBranchId, actor);
    if (!scope) throw new HttpError('Service is inactive or does not provide maintenance', 409);
    return scope;
  },
  async deleteMaintenanceScope(serviceId: string, scopeId: string, officeBranchId: string, actor: AuditActor) {
    const service = await serviceRepository.findById(serviceId, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is inactive', 409);
    if (!service.hasMaintenance) throw new HttpError('Service does not provide maintenance', 409);
    const scope = await serviceRepository.revokeMaintenanceScope(serviceId, scopeId, officeBranchId, actor);
    if (!scope) throw new HttpError('Maintenance scope not found', 404);
    return scope;
  },
  async delete(id: string, version: number, officeBranchId: string, actor: AuditActor) {
    const service = await serviceRepository.findById(id, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is already inactive', 409);
    return serviceRepository.deactivate(id, version, officeBranchId, actor);
  },
  async createInspectionScope(serviceId: string, data: CreateInspectionScopeInput, officeBranchId: string, actor: AuditActor) {
    if (!await serviceRepository.findById(serviceId, officeBranchId)) throw new HttpError('Service not found', 404);
    const existing = await serviceRepository.findInspectionScopeByName(serviceId, data.inspectionScope, officeBranchId);
    if (existing && !existing.revoked) throw new HttpError(`Inspection scope '${data.inspectionScope}' already exists`, 409);
    const inspectionScope = await serviceRepository.createInspectionScope(serviceId, data.inspectionScope, officeBranchId, actor);
    if (!inspectionScope) throw new HttpError('Service is inactive', 409);
    return inspectionScope;
  },
  async deleteInspectionScope(serviceId: string, inspectionScopeId: string, officeBranchId: string, actor: AuditActor) {
    const service = await serviceRepository.findById(serviceId, officeBranchId);
    if (!service) throw new HttpError('Service not found', 404);
    if (!service.isActive) throw new HttpError('Service is inactive', 409);
    const inspectionScope = await serviceRepository.revokeInspectionScope(serviceId, inspectionScopeId, officeBranchId, actor);
    if (!inspectionScope) throw new HttpError('Inspection scope not found', 404);
    return inspectionScope;
  },
};
