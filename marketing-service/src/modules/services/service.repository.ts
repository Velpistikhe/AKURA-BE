import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { defineSortRules, findAll } from '../../utils/listQuery.js';
import { CreateServiceInput, ListServicesInput, UpdateServiceInput } from './service.schemas.js';

const scopeSelect = {
  id: true, serviceId: true, scope: true, revoked: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ServiceScopeSelect;

const maintenanceScopeSelect = {
  id: true, serviceId: true, scope: true, revoked: true, createdAt: true, updatedAt: true,
} satisfies Prisma.MaintenanceScopeSelect;

const detailSelect = {
  id: true, officeBranchId: true, name: true, hasMaintenance: true,
  isActive: true, createdAt: true, updatedAt: true,
  scopes: { where: { revoked: false }, select: scopeSelect },
  maintenanceScopes: { where: { revoked: false }, select: maintenanceScopeSelect },
} satisfies Prisma.ServiceSelect;

const listSelect = {
  id: true, officeBranchId: true, name: true, hasMaintenance: true,
  isActive: true, createdAt: true, updatedAt: true,
  scopes: {
    where: { revoked: false },
    orderBy: { createdAt: 'asc' as const },
    select: { scope: true },
  },
  maintenanceScopes: {
    where: { revoked: false },
    orderBy: { createdAt: 'asc' as const },
    select: { scope: true },
  },
} satisfies Prisma.ServiceSelect;

type ServiceListRow = Prisma.ServiceGetPayload<{ select: typeof listSelect }>;

export const serviceRepository = {
  async list(input: ListServicesInput, officeBranchId: string) {
    const result = await findAll<ServiceListRow, NonNullable<ListServicesInput['sortBy']>, ListServicesInput, Prisma.ServiceWhereInput, Prisma.ServiceOrderByWithRelationInput>(
      input,
      {
      baseWhere: { officeBranchId, isActive: true } as Prisma.ServiceWhereInput,
      filters: {
        isActive: (isActive) => ({ isActive }),
        name: (name) => ({ name: { contains: name, mode: 'insensitive' } }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListServicesInput['sortBy']>, Prisma.ServiceOrderByWithRelationInput>({
        name: (direction) => ({ name: direction }),
        isActive: (direction) => ({ isActive: direction }),
      }),
      },
      (query) => prisma.service.findMany({ ...query, select: listSelect }),
      (where) => prisma.service.count({ where }),
    );
    return {
      services: result.items.map(({ scopes, maintenanceScopes, ...service }) => ({
        ...service,
        scopes: scopes.map(({ scope }) => scope).join(', '),
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
  create: (data: CreateServiceInput, officeBranchId: string) => prisma.service.create({
    data: {
      officeBranchId,
      name: data.name,
      hasMaintenance: data.hasMaintenance,
      isActive: true,
      scopes: { create: data.scopes.map((scope) => ({ scope, revoked: false })) },
      maintenanceScopes: data.hasMaintenance
        ? { create: data.maintenanceScopes.map((scope) => ({ scope, revoked: false })) }
        : undefined,
    },
    select: detailSelect,
  }),
  update: (id: string, officeBranchId: string, data: UpdateServiceInput) => prisma.$transaction(async (tx) => {
    const { scopes, maintenanceScopes, ...serviceData } = data;
    await tx.service.update({ where: { id, officeBranchId }, data: serviceData });

    if (scopes !== undefined) {
      await tx.serviceScope.updateMany({ where: { serviceId: id, revoked: false }, data: { revoked: true } });
      for (const scope of scopes) {
        await tx.serviceScope.upsert({
          where: { serviceId_scope: { serviceId: id, scope } },
          create: { serviceId: id, scope, revoked: false },
          update: { revoked: false },
        });
      }
    }

    if (data.hasMaintenance === false) {
      await tx.maintenanceScope.updateMany({ where: { serviceId: id, revoked: false }, data: { revoked: true } });
    } else if (maintenanceScopes !== undefined) {
      await tx.maintenanceScope.updateMany({ where: { serviceId: id, revoked: false }, data: { revoked: true } });
      for (const scope of maintenanceScopes) {
        await tx.maintenanceScope.upsert({
          where: { serviceId_scope: { serviceId: id, scope } },
          create: { serviceId: id, scope, revoked: false },
          update: { revoked: false },
        });
      }
    }

    return tx.service.findFirstOrThrow({ where: { id, officeBranchId }, select: detailSelect });
  }),
  async deactivate(id: string, officeBranchId: string) {
    return prisma.service.update({ where: { id, officeBranchId }, data: { isActive: false }, select: detailSelect });
  },
  findScopeByName: (serviceId: string, scope: string, officeBranchId: string) => prisma.serviceScope.findFirst({
    where: { serviceId, scope, service: { officeBranchId } },
    select: scopeSelect,
  }),
  findMaintenanceScopeByName: (serviceId: string, scope: string, officeBranchId: string) => prisma.maintenanceScope.findFirst({
    where: { serviceId, scope, service: { officeBranchId } },
    select: maintenanceScopeSelect,
  }),
  async createMaintenanceScope(serviceId: string, scope: string, officeBranchId: string) {
    const service = await prisma.service.findFirst({ where: { id: serviceId, officeBranchId }, select: { hasMaintenance: true, isActive: true } });
    if (!service?.isActive || !service.hasMaintenance) return null;
    return prisma.maintenanceScope.upsert({
      where: { serviceId_scope: { serviceId, scope } },
      create: { serviceId, scope, revoked: false },
      update: { revoked: false },
      select: maintenanceScopeSelect,
    });
  },
  async revokeMaintenanceScope(serviceId: string, scopeId: string, officeBranchId: string) {
    const service = await prisma.service.findFirst({ where: { id: serviceId, officeBranchId }, select: { hasMaintenance: true, isActive: true } });
    if (!service?.isActive || !service.hasMaintenance) return null;
    return prisma.maintenanceScope.updateMany({
      where: { id: scopeId, serviceId, revoked: false },
      data: { revoked: true },
    }).then(async (result) => result.count
      ? prisma.maintenanceScope.findUnique({ where: { id: scopeId }, select: maintenanceScopeSelect })
      : null);
  },
  async createScope(serviceId: string, scope: string, officeBranchId: string) {
    const service = await prisma.service.findFirst({ where: { id: serviceId, officeBranchId }, select: { isActive: true } });
    if (!service?.isActive) return null;
    return prisma.serviceScope.upsert({
      where: { serviceId_scope: { serviceId, scope } },
      create: { serviceId, scope, revoked: false },
      update: { revoked: false },
      select: scopeSelect,
    });
  },
  async revokeScope(serviceId: string, scopeId: string, officeBranchId: string) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.serviceScope.findFirst({
        where: { id: scopeId, serviceId, revoked: false },
        select: { id: true },
      });
      const service = await tx.service.findFirst({ where: { id: serviceId, officeBranchId }, select: { isActive: true } });
      if (!service?.isActive) return null;
      if (!current) return null;
      return tx.serviceScope.update({
        where: { id: current.id },
        data: { revoked: true },
        select: scopeSelect,
      });
    });
  },
};
