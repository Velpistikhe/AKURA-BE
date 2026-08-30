import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { CreateMaintenanceInput, ListMaintenancesInput } from './maintenance.schemas.js';

const scopeSelect = {
  id: true, maintenanceId: true, scope: true, revoked: true, createdAt: true, updatedAt: true,
} satisfies Prisma.MaintenanceScopeSelect;

const detailSelect = {
  id: true, name: true, isActive: true, createdAt: true, updatedAt: true,
  scopes: { where: { revoked: false }, select: scopeSelect },
} satisfies Prisma.MaintenanceSelect;

const listSelect = {
  id: true, name: true, isActive: true, createdAt: true, updatedAt: true,
  scopes: {
    where: { revoked: false },
    orderBy: { createdAt: 'asc' as const },
    select: { scope: true },
  },
} satisfies Prisma.MaintenanceSelect;

export const maintenanceRepository = {
  async list(input: ListMaintenancesInput) {
    const query = buildListQuery(input, {
      filters: {
        isActive: (isActive) => ({ isActive }),
        name: (name) => ({ name: { contains: name, mode: 'insensitive' } }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListMaintenancesInput['sortBy']>, Prisma.MaintenanceOrderByWithRelationInput>({
        name: (direction) => ({ name: direction }),
        isActive: (direction) => ({ isActive: direction }),
      }),
    });
    const [maintenances, total] = await Promise.all([
      prisma.maintenance.findMany({ ...query, select: listSelect }),
      prisma.maintenance.count({ where: query.where }),
    ]);
    return {
      maintenances: maintenances.map(({ scopes, ...maintenance }) => ({
        ...maintenance,
        scopes: scopes.map(({ scope }) => scope).join(', '),
      })),
      pagination: buildPagination(input.page, input.limit, total),
    };
  },
  findById: (id: string) => prisma.maintenance.findUnique({ where: { id }, select: detailSelect }),
  create: (data: CreateMaintenanceInput) => prisma.maintenance.create({
    data: {
      name: data.name,
      isActive: data.isActive,
      scopes: { create: data.scopes.map((scope) => ({ scope, revoked: false })) },
    },
    select: detailSelect,
  }),
  findScopeByName: (maintenanceId: string, scope: string) => prisma.maintenanceScope.findUnique({
    where: { maintenanceId_scope: { maintenanceId, scope } },
    select: scopeSelect,
  }),
  createScope: (maintenanceId: string, scope: string) => prisma.maintenanceScope.upsert({
    where: { maintenanceId_scope: { maintenanceId, scope } },
    create: { maintenanceId, scope, revoked: false },
    update: { revoked: false },
    select: scopeSelect,
  }),
  async revokeScope(maintenanceId: string, scopeId: string) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.maintenanceScope.findFirst({
        where: { id: scopeId, maintenanceId, revoked: false },
        select: { id: true },
      });
      if (!current) return null;
      return tx.maintenanceScope.update({
        where: { id: current.id },
        data: { revoked: true },
        select: scopeSelect,
      });
    });
  },
};
