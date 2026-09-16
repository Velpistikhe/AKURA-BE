import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { defineSortRules, findAll } from '../../utils/listQuery.js';
import { CreateServiceInput, ListServicesInput, UpdateServiceInput } from './service.schemas.js';
import { AuditActor } from '../../types/auth.types.js';
import { recordCatalogAudit } from '../../utils/catalogAudit.js';
import { HttpError } from '../../utils/httpError.js';

const inspectionScopeSelect = {
  id: true, serviceId: true, inspectionScope: true, revoked: true, createdAt: true, updatedAt: true,
} satisfies Prisma.InspectionScopeSelect;

const maintenanceScopeSelect = {
  id: true, serviceId: true, scope: true, revoked: true, createdAt: true, updatedAt: true,
} satisfies Prisma.MaintenanceScopeSelect;

const detailSelect = {
  id: true, officeBranchId: true, name: true, type: true, hasMaintenance: true, version: true,
  isActive: true, createdById: true, createdByName: true, updatedById: true, updatedByName: true, createdAt: true, updatedAt: true,
  inspectionScopes: { where: { revoked: false }, select: inspectionScopeSelect },
  maintenanceScopes: { where: { revoked: false }, select: maintenanceScopeSelect },
} satisfies Prisma.ServiceSelect;

const listSelect = {
  id: true, officeBranchId: true, name: true, type: true, hasMaintenance: true, version: true,
  isActive: true, createdById: true, createdByName: true, updatedById: true, updatedByName: true, createdAt: true, updatedAt: true,
  inspectionScopes: {
    where: { revoked: false },
    orderBy: { createdAt: 'asc' as const },
    select: { inspectionScope: true },
  },
  maintenanceScopes: {
    where: { revoked: false },
    orderBy: { createdAt: 'asc' as const },
    select: { scope: true },
  },
} satisfies Prisma.ServiceSelect;

type ServiceListRow = Prisma.ServiceGetPayload<{ select: typeof listSelect }>;
type Snapshot = Record<string, unknown> | null;
const snapshot = (value: unknown): Snapshot => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const displayScopes = (value: unknown) => Array.isArray(value)
  ? value.map((entry) => (snapshot(entry)?.inspectionScope ?? snapshot(entry)?.scope)).filter((scope): scope is string => typeof scope === 'string').join(', ')
  : value;
const historyFields = [
  ['name', 'Service name'], ['type', 'Service type'], ['hasMaintenance', 'Provides maintenance'], ['isActive', 'Active status'],
  ['inspectionScopes', 'Inspection scopes'], ['maintenanceScopes', 'Maintenance scopes'],
] as const;
// Audit snapshots written before the rename still use scopes/scope.
const historyValue = (value: Snapshot, field: string) => field === 'inspectionScopes'
  ? value?.inspectionScopes ?? value?.scopes
  : value?.[field];
const historyChanges = (before: Snapshot, after: Snapshot, action: string) => historyFields.flatMap(([field, label]) => {
  const previous = field.endsWith('Scopes') ? displayScopes(historyValue(before, field)) : before?.[field] ?? null;
  const current = field.endsWith('Scopes') ? displayScopes(historyValue(after, field)) : after?.[field] ?? null;
  return action === 'CREATE' || !equal(previous, current)
    ? [{ field, label, before: action === 'CREATE' ? null : previous, after: current }]
    : [];
});

export const serviceRepository = {
  async list(input: ListServicesInput, officeBranchId: string) {
    const result = await findAll<ServiceListRow, NonNullable<ListServicesInput['sortBy']>, ListServicesInput, Prisma.ServiceWhereInput, Prisma.ServiceOrderByWithRelationInput>(
      input,
      {
      baseWhere: { officeBranchId } as Prisma.ServiceWhereInput,
      filters: {
        type: (type) => ({ type }),
        isActive: (isActive) => ({ isActive }),
        name: (name) => ({ name: { contains: name, mode: 'insensitive' } }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListServicesInput['sortBy']>, Prisma.ServiceOrderByWithRelationInput>({
        name: (direction) => ({ name: direction }),
        type: (direction) => ({ type: direction }),
        isActive: (direction) => ({ isActive: direction }),
      }),
      },
      (query) => prisma.service.findMany({ ...query, select: listSelect }),
      (where) => prisma.service.count({ where }),
    );
    return {
      services: result.items.map(({ inspectionScopes, maintenanceScopes, ...service }) => ({
        ...service,
        inspectionScopes: inspectionScopes.map(({ inspectionScope }) => inspectionScope).join(', '),
        maintenanceScopes: maintenanceScopes.map(({ scope }) => scope).join(', '),
      })),
      pagination: result.pagination,
    };
  },
  async findById(id: string, officeBranchId: string) {
    const service = await prisma.service.findFirst({ where: { id, officeBranchId }, select: detailSelect });
    if (!service) return null;
    return service;
  },
  async findActiveById(id: string, officeBranchId: string) {
    return prisma.service.findFirst({ where: { id, officeBranchId, isActive: true }, select: detailSelect });
  },
  async history(id: string, officeBranchId: string, input: { page: number; limit: number }) {
    const service = await prisma.service.findFirst({ where: { id, officeBranchId }, select: { id: true } });
    if (!service) throw new HttpError('Service not found', 404);
    const where = { officeBranchId, entityType: 'SERVICE' as const, entityId: id };
    const [records, total] = await prisma.$transaction([
      prisma.catalogAuditLog.findMany({ where, orderBy: { version: 'desc' }, skip: (input.page - 1) * input.limit, take: input.limit }),
      prisma.catalogAuditLog.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    return {
      serviceId: id,
      history: records.map((record) => ({
        id: record.id, action: record.action === 'SCOPE_ADD' ? 'INSPECTION_SCOPE_ADD' : record.action === 'SCOPE_REMOVE' ? 'INSPECTION_SCOPE_REMOVE' : record.action, version: record.version,
        changedBy: { id: record.createdById, name: record.createdByName }, changedAt: record.createdAt,
        changes: historyChanges(snapshot(record.before), snapshot(record.after), record.action),
      })),
      pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
    };
  },
  create: async (data: CreateServiceInput, officeBranchId: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, officeBranchId);
    const row = await tx.service.create({
    data: {
      officeBranchId,
      name: data.name,
      type: data.type,
      hasMaintenance: data.hasMaintenance,
      isActive: true,
      createdById: actor.id, createdByName: actor.name,
      inspectionScopes: { create: data.inspectionScopes.map((inspectionScope) => ({ inspectionScope, revoked: false })) },
      maintenanceScopes: data.hasMaintenance
        ? { create: data.maintenanceScopes.map((scope) => ({ scope, revoked: false })) }
        : undefined,
    },
    select: detailSelect,
    });
    await recordCatalogAudit(tx, officeBranchId, 'SERVICE', null, row, actor, 'CREATE');
    return row;
  }),
  update: (id: string, officeBranchId: string, data: UpdateServiceInput, actor: AuditActor) => prisma.$transaction(async (tx) => {
    await lockCompanyBranch(tx, officeBranchId);
    const before = await tx.service.findFirst({ where: { id, officeBranchId }, select: detailSelect });
    if (!before || before.version !== data.version) throw new HttpError('Data has changed; reload before retrying', 409);
    if (!before.isActive) throw new HttpError('Service is inactive', 409);
    const { version, ...serviceData } = data;
    await tx.service.update({ where: { id, version }, data: { ...serviceData, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });

    if (data.hasMaintenance === false) {
      await tx.maintenanceScope.updateMany({ where: { serviceId: id, revoked: false }, data: { revoked: true } });
    }

    const after = await tx.service.findFirstOrThrow({ where: { id, officeBranchId }, select: detailSelect });
    await recordCatalogAudit(tx, officeBranchId, 'SERVICE', before, after, actor, 'UPDATE');
    return after;
  }),
  async deactivate(id: string, version: number, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async tx => {
      await lockCompanyBranch(tx, officeBranchId);
      const before = await tx.service.findFirst({ where: { id, officeBranchId }, select: detailSelect });
      if (!before || before.version !== version) throw new HttpError('Data has changed; reload before retrying', 409);
      if (!before.isActive) throw new HttpError('Service is inactive', 409);
      // Standard prices leave the catalog; contract prices and contracts remain untouched.
      const standardPrices = await tx.itemPrice.findMany({ where: { isActive: true, itemSize: { item: { serviceId: id, officeBranchId } } } });
      for (const price of standardPrices) {
        const closed = await tx.itemPrice.update({ where: { id: price.id, version: price.version }, data: {
          isActive: false, effectiveUntil: new Date(Math.max(Date.now(), price.effectiveFrom.getTime())),
          version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name,
        } });
        await recordCatalogAudit(tx, officeBranchId, 'ITEM_PRICE', price, closed, actor, 'DEACTIVATE');
      }
      await tx.service.update({ where: { id, version }, data: { isActive: false, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      const after = await tx.service.findUniqueOrThrow({ where: { id }, select: detailSelect });
      await recordCatalogAudit(tx, officeBranchId, 'SERVICE', before, after, actor, 'DEACTIVATE');
      return after;
    });
  },
  findInspectionScopeByName: (serviceId: string, inspectionScope: string, officeBranchId: string) => prisma.inspectionScope.findFirst({
    where: { serviceId, inspectionScope, service: { officeBranchId } },
    select: inspectionScopeSelect,
  }),
  findMaintenanceScopeByName: (serviceId: string, scope: string, officeBranchId: string) => prisma.maintenanceScope.findFirst({
    where: { serviceId, scope, service: { officeBranchId } },
    select: maintenanceScopeSelect,
  }),
  async createMaintenanceScope(serviceId: string, scope: string, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, officeBranchId);
    const before = await tx.service.findFirst({ where: { id: serviceId, officeBranchId }, select: detailSelect });
    if (!before?.isActive || !before.hasMaintenance) return null;
    if (before.maintenanceScopes.some((item) => item.scope === scope)) {
      throw new HttpError(`Maintenance scope '${scope}' already exists`, 409);
    }
    const row = await tx.maintenanceScope.upsert({
      where: { serviceId_scope: { serviceId, scope } },
      create: { serviceId, scope, revoked: false }, update: { revoked: false },
      select: maintenanceScopeSelect,
    });
    const after = await tx.service.update({ where: { id: serviceId, version: before.version }, data: { version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name }, select: detailSelect });
    await recordCatalogAudit(tx, officeBranchId, 'SERVICE', before, after, actor, 'MAINTENANCE_SCOPE_ADD');
    return row;
    });
  },
  async revokeMaintenanceScope(serviceId: string, scopeId: string, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async tx => {
      await lockCompanyBranch(tx, officeBranchId);
      const before = await tx.service.findFirst({ where: { id: serviceId, officeBranchId }, select: detailSelect });
      if (!before?.isActive || !before.hasMaintenance) return null;
      const current = await tx.maintenanceScope.findFirst({ where: { id: scopeId, serviceId, revoked: false } });
      if (!current) return null;
      const row = await tx.maintenanceScope.update({ where: { id: scopeId }, data: { revoked: true }, select: maintenanceScopeSelect });
      const after = await tx.service.update({ where: { id: serviceId, version: before.version }, data: { version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name }, select: detailSelect });
      await recordCatalogAudit(tx, officeBranchId, 'SERVICE', before, after, actor, 'MAINTENANCE_SCOPE_REMOVE');
      return row;
    });
  },
  async createInspectionScope(serviceId: string, inspectionScope: string, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, officeBranchId);
    const before = await tx.service.findFirst({ where: { id: serviceId, officeBranchId }, select: detailSelect });
    if (!before?.isActive) return null;
    if (before.inspectionScopes.some((item) => item.inspectionScope === inspectionScope)) {
      throw new HttpError(`Inspection scope '${inspectionScope}' already exists`, 409);
    }
    const row = await tx.inspectionScope.upsert({
      where: { serviceId_inspectionScope: { serviceId, inspectionScope } },
      create: { serviceId, inspectionScope, revoked: false }, update: { revoked: false },
      select: inspectionScopeSelect,
    });
    const after = await tx.service.update({ where: { id: serviceId, version: before.version }, data: { version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name }, select: detailSelect });
    await recordCatalogAudit(tx, officeBranchId, 'SERVICE', before, after, actor, 'INSPECTION_SCOPE_ADD');
    return row;
    });
  },
  async revokeInspectionScope(serviceId: string, inspectionScopeId: string, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async (tx) => {
      await lockCompanyBranch(tx, officeBranchId);
      const before = await tx.service.findFirst({ where: { id: serviceId, officeBranchId }, select: detailSelect });
      if (!before?.isActive) return null;
      const current = await tx.inspectionScope.findFirst({
        where: { id: inspectionScopeId, serviceId, revoked: false },
        select: { id: true },
      });
      if (!current) return null;
      const row = await tx.inspectionScope.update({
        where: { id: current.id },
        data: { revoked: true },
        select: inspectionScopeSelect,
      });
      const after = await tx.service.update({ where: { id: serviceId, version: before.version }, data: { version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name }, select: detailSelect });
      await recordCatalogAudit(tx, officeBranchId, 'SERVICE', before, after, actor, 'INSPECTION_SCOPE_REMOVE');
      return row;
    });
  },
};
