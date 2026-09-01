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
  id: true, code: true, name: true, hasMaintenance: true,
  isActive: true, createdAt: true, updatedAt: true,
  scopes: { where: { revoked: false }, select: scopeSelect },
  maintenanceScopes: { where: { revoked: false }, select: maintenanceScopeSelect },
} satisfies Prisma.ServiceSelect;

const listSelect = {
  id: true, code: true, name: true, hasMaintenance: true,
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

export const serviceRepository = {
  async list(input: ListServicesInput) {
    const result = await findAll(
      input,
      {
      filters: {
        isActive: (isActive) => ({ isActive }),
        code: (code) => ({ code: { contains: code, mode: 'insensitive' } }),
        name: (name) => ({ name: { contains: name, mode: 'insensitive' } }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListServicesInput['sortBy']>, Prisma.ServiceOrderByWithRelationInput>({
        code: (direction) => ({ code: direction }), name: (direction) => ({ name: direction }),
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
  async findById(id: string) {
    const service = await prisma.service.findUnique({ where: { id }, select: detailSelect });
    if (!service) return null;
    return service;
  },
  findByCode: (code: string) => prisma.service.findUnique({ where: { code }, select: { id: true } }),
  create: (data: CreateServiceInput) => prisma.service.create({
    data: {
      code: data.code,
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
  update: (id: string, data: UpdateServiceInput) => prisma.$transaction(async (tx) => {
    const { scopes, maintenanceScopes, ...serviceData } = data;
    await tx.service.update({ where: { id }, data: serviceData });

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

    return tx.service.findUniqueOrThrow({ where: { id }, select: detailSelect });
  }),
  async deactivate(id: string) {
    return prisma.service.update({ where: { id }, data: { isActive: false }, select: detailSelect });
  },
  findScopeByName: (serviceId: string, scope: string) => prisma.serviceScope.findUnique({
    where: { serviceId_scope: { serviceId, scope } },
    select: scopeSelect,
  }),
  findMaintenanceScopeByName: (serviceId: string, scope: string) => prisma.maintenanceScope.findUnique({
    where: { serviceId_scope: { serviceId, scope } },
    select: maintenanceScopeSelect,
  }),
  async createMaintenanceScope(serviceId: string, scope: string) {
    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { hasMaintenance: true, isActive: true } });
    if (!service?.isActive || !service.hasMaintenance) return null;
    return prisma.maintenanceScope.upsert({
      where: { serviceId_scope: { serviceId, scope } },
      create: { serviceId, scope, revoked: false },
      update: { revoked: false },
      select: maintenanceScopeSelect,
    });
  },
  async revokeMaintenanceScope(serviceId: string, scopeId: string) {
    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { hasMaintenance: true, isActive: true } });
    if (!service?.isActive || !service.hasMaintenance) return null;
    return prisma.maintenanceScope.updateMany({
      where: { id: scopeId, serviceId, revoked: false },
      data: { revoked: true },
    }).then(async (result) => result.count
      ? prisma.maintenanceScope.findUnique({ where: { id: scopeId }, select: maintenanceScopeSelect })
      : null);
  },
  async createScope(serviceId: string, scope: string) {
    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { isActive: true } });
    if (!service?.isActive) return null;
    return prisma.serviceScope.upsert({
      where: { serviceId_scope: { serviceId, scope } },
      create: { serviceId, scope, revoked: false },
      update: { revoked: false },
      select: scopeSelect,
    });
  },
  async revokeScope(serviceId: string, scopeId: string) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.serviceScope.findFirst({
        where: { id: scopeId, serviceId, revoked: false },
        select: { id: true },
      });
      const service = await tx.service.findUnique({ where: { id: serviceId }, select: { isActive: true } });
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
