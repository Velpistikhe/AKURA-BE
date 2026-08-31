import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { defineSortRules, findAll } from '../../utils/listQuery.js';
import { CreateServiceInput, ListServicesInput, UpdateServiceInput } from './service.schemas.js';

const scopeSelect = {
  id: true, serviceId: true, scope: true, revoked: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ServiceScopeSelect;

const detailSelect = {
  id: true, code: true, name: true, hasService: true,
  maintenanceId: true,
  maintenance: { select: { id: true, name: true, isActive: true, scopes: { where: { revoked: false }, select: { id: true, scope: true } } } },
  isActive: true, createdAt: true, updatedAt: true,
  scopes: { where: { revoked: false }, select: scopeSelect },
} satisfies Prisma.ServiceSelect;

const listSelect = {
  id: true, code: true, name: true, hasService: true,
  maintenanceId: true,
  maintenance: { select: { id: true, name: true, isActive: true } },
  isActive: true, createdAt: true, updatedAt: true,
  scopes: {
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
      services: result.items.map(({ scopes, ...service }) => ({
        ...service,
        scopes: scopes.map(({ scope }) => scope).join(', '),
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
      hasService: data.hasService,
      maintenance: data.hasService && data.maintenance ? { create: {
        name: data.maintenance.name, isActive: true,
        scopes: { create: data.maintenance.scopes.map((scope) => ({ scope, revoked: false })) },
      } } : undefined,
      isActive: true,
      scopes: { create: data.scopes.map((scope) => ({ scope, revoked: false })) },
    },
    select: detailSelect,
  }),
  update: (id: string, data: UpdateServiceInput) => prisma.service.update({ where: { id }, data, select: detailSelect }),
  async deactivate(id: string) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.service.findUnique({ where: { id }, select: { maintenanceId: true } });
      if (!current) return null;
      await tx.service.update({ where: { id }, data: { isActive: false } });
      if (current.maintenanceId) await tx.maintenance.update({ where: { id: current.maintenanceId }, data: { isActive: false } });
      return tx.service.findUnique({ where: { id }, select: detailSelect });
    });
  },
  findScopeByName: (serviceId: string, scope: string) => prisma.serviceScope.findUnique({
    where: { serviceId_scope: { serviceId, scope } },
    select: scopeSelect,
  }),
  async createMaintenanceScope(serviceId: string, scope: string) {
    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { maintenanceId: true, maintenance: { select: { isActive: true } } } });
    if (!service?.maintenanceId || !service.maintenance?.isActive) return null;
    return prisma.maintenanceScope.upsert({
      where: { maintenanceId_scope: { maintenanceId: service.maintenanceId, scope } },
      create: { maintenanceId: service.maintenanceId, scope, revoked: false },
      update: { revoked: false },
      select: { id: true, maintenanceId: true, scope: true, revoked: true, createdAt: true, updatedAt: true },
    });
  },
  async revokeMaintenanceScope(serviceId: string, scopeId: string) {
    const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { maintenanceId: true, maintenance: { select: { isActive: true } } } });
    if (!service?.maintenanceId || !service.maintenance?.isActive) return null;
    return prisma.maintenanceScope.updateMany({
      where: { id: scopeId, maintenanceId: service.maintenanceId, revoked: false },
      data: { revoked: true },
    }).then(async (result) => result.count ? prisma.maintenanceScope.findUnique({ where: { id: scopeId }, select: { id: true, maintenanceId: true, scope: true, revoked: true, createdAt: true, updatedAt: true } }) : null);
  },
  async createMaintenance(serviceId: string, data: { name: string; scopes: string[] }) {
    return prisma.$transaction(async (tx) => {
      const service = await tx.service.findUnique({ where: { id: serviceId }, select: { maintenanceId: true } });
      if (!service) return null;
      if (service.maintenanceId) return null;
      const maintenance = await tx.maintenance.create({
        data: { name: data.name, isActive: true, scopes: { create: data.scopes.map((scope) => ({ scope, revoked: false })) } },
        select: { id: true, name: true, isActive: true, scopes: { where: { revoked: false }, select: { id: true, scope: true } } },
      });
      await tx.service.update({ where: { id: serviceId }, data: { maintenanceId: maintenance.id, hasService: true } });
      return maintenance;
    });
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
