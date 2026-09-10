import { normalizeName } from '../../utils/normalizeName.js';
import { lockCompanyBranch, recordCompanyAudit, requireCurrentVersion } from '../../utils/companyAudit.js';
import { CompanyType, Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { CreateCompanyInput, ListCompaniesInput, UpdateCompanyInput } from './company.schemas.js';
import { AuditActor } from '../../types/auth.types.js';

const select = {
  createdById: true, updatedById: true,
  id: true, officeBranchId: true, name: true, normalizeName: true, type: true, address: true,
  hasContract: true, revoked: true, version: true, createdAt: true, updatedAt: true,
  _count: { select: { staffs: { where: { revoked: false } } } },
} satisfies Prisma.CompanySelect;

const isUniqueError = (error: unknown): boolean => (
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
);

export const companyRepository = {
  async list(input: ListCompaniesInput, officeBranchId: string) {
    const query = buildListQuery(input, {
      filters: {
        hasContract: (hasContract) => ({ hasContract }),
        search: (search) => ({ OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { type: { in: Object.values(CompanyType).filter((type) => type.toLowerCase().includes(search.toLowerCase())) } },
          { address: { contains: search, mode: 'insensitive' } },
        ] }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListCompaniesInput['sortBy']>, Prisma.CompanyOrderByWithRelationInput>({
        name: (direction) => ({ name: direction }), type: (direction) => ({ type: direction }),
        address: (direction) => ({ address: direction }), hasContract: (direction) => ({ hasContract: direction }),
        version: (direction) => ({ version: direction }), updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    const where = { AND: [{ officeBranchId, revoked: false }, query.where] } satisfies Prisma.CompanyWhereInput;
    const [companies, total] = await Promise.all([
      prisma.company.findMany({ ...query, where, select }),
      prisma.company.count({ where }),
    ]);
    return { companies, pagination: buildPagination(input.page, input.limit, total) };
  },

  findById: (id: string, officeBranchId: string) => prisma.company.findFirst({ where: { id, officeBranchId, revoked: false }, select }),

  findByNormalizeName: (normalizeName: string, officeBranchId: string, excludeId?: string) => prisma.company.findFirst({
    where: { normalizeName, officeBranchId, revoked: false, ...(excludeId && { id: { not: excludeId } }) },
    select: { id: true },
  }),


  async create(data: CreateCompanyInput & { normalizeName: string; officeBranchId: string }, actor: AuditActor) {
    return prisma.$transaction(async (tx) => {
      await lockCompanyBranch(tx, data.officeBranchId);
      const duplicate = await tx.company.findFirst({ where: { normalizeName: data.normalizeName, officeBranchId: data.officeBranchId, revoked: false } });
      if (duplicate) throw new HttpError('Company name already exists', 409);
      const created = await tx.company.create({ data: { ...data, createdById: actor.id, version: 0 }, select });
      await recordCompanyAudit(tx, data.officeBranchId, 'COMPANY', created.id, 'CREATE', null, created, actor);
      return created;
    });
  },

  async createVersion(id: string, officeBranchId: string, data: UpdateCompanyInput, actor: AuditActor) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockCompanyBranch(tx, officeBranchId);
        const current = await tx.company.findFirst({
          where: { id, officeBranchId },
          include: { staffs: { where: { revoked: false } }, contractPrices: true },
        });
        if (!current) throw new HttpError('Company not found', 404);
        requireCurrentVersion(current, data.version);
        const normalized = normalizeName(data.name ?? current.name);
        const conflict = await tx.company.findFirst({
          where: { normalizeName: normalized, officeBranchId, revoked: false, id: { not: id } },
        });
        if (conflict) throw new HttpError('Company name already exists', 409);
        const retired = await tx.company.update({
          where: { id, officeBranchId, version: data.version, revoked: false },
          data: { revoked: true, updatedById: actor.id },
        });
        for (const staff of current.staffs) {
          const retiredStaff = await tx.companyStaff.update({
            where: { id: staff.id }, data: { revoked: true, updatedById: actor.id, version: { increment: 1 } },
          });
          await recordCompanyAudit(tx, officeBranchId, 'COMPANY_STAFF', staff.id, 'DEACTIVATE', staff, retiredStaff, actor);
        }
        const created = await tx.company.create({
          data: {
            officeBranchId, name: data.name ?? current.name, normalizeName: normalized,
            type: data.type ?? current.type, address: data.address ?? current.address,
            hasContract: data.hasContract ?? current.hasContract, version: current.version + 1,
            createdById: actor.id,
            contractPrices: { create: current.contractPrices.map((price) => ({
              itemSizeId: price.itemSizeId, priceService: price.priceService, priceMaintenance: price.priceMaintenance,
              effectiveFrom: price.effectiveFrom, effectiveUntil: price.effectiveUntil, isActive: price.isActive,
              createdById: actor.id, createdByName: actor.name,
            })) },
          },
        });
        for (const staff of current.staffs) {
          const copied = await tx.companyStaff.create({ data: {
            companyId: created.id, name: staff.name, normalizeName: staff.normalizeName, title: staff.title,
            telp: staff.telp, email: staff.email, version: 0, createdById: actor.id,
          } });
          await recordCompanyAudit(tx, officeBranchId, 'COMPANY_STAFF', copied.id, 'COPY', staff, copied, actor);
        }
        const result = await tx.company.findUniqueOrThrow({ where: { id: created.id }, select });
        await recordCompanyAudit(tx, officeBranchId, 'COMPANY', id, 'DEACTIVATE', current, retired, actor);
        await recordCompanyAudit(tx, officeBranchId, 'COMPANY', result.id, 'UPDATE', current, result, actor);
        return result;
      });
    } catch (error) {
      if (isUniqueError(error)) throw new HttpError('Company or staff name already exists', 409);
      throw error;
    }
  },

  revoke(id: string, officeBranchId: string, version: number, actor: AuditActor) {
    return prisma.$transaction(async (tx) => {
      await lockCompanyBranch(tx, officeBranchId);
      const current = await tx.company.findFirst({
        where: { id, officeBranchId }, include: { staffs: { where: { revoked: false } } },
      });
      if (!current) throw new HttpError('Company not found', 404);
      requireCurrentVersion(current, version);
      for (const staff of current.staffs) {
        const updatedStaff = await tx.companyStaff.update({
          where: { id: staff.id }, data: { revoked: true, version: { increment: 1 }, updatedById: actor.id },
        });
        await recordCompanyAudit(tx, officeBranchId, 'COMPANY_STAFF', staff.id, 'DEACTIVATE', staff, updatedStaff, actor);
      }
      const updated = await tx.company.update({
        where: { id, officeBranchId, version, revoked: false },
        data: { revoked: true, version: { increment: 1 }, updatedById: actor.id }, select,
      });
      await recordCompanyAudit(tx, officeBranchId, 'COMPANY', id, 'DEACTIVATE', current, updated, actor);
      return updated;
    });
  },
};
