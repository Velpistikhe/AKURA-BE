import { AuditActor } from '../../types/auth.types.js';
import { lockCompanyBranch, recordCompanyAudit, requireCurrentVersion } from '../../utils/companyAudit.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { CreateCompanyStaffInput, ListCompanyStaffInput, UpdateCompanyStaffInput } from './company-staff.schemas.js';

const select = {
  createdById: true, updatedById: true,
  id: true, companyId: true, name: true, normalizeName: true, title: true,
  telp: true, email: true, revoked: true, version: true, createdAt: true, updatedAt: true,
  company: { select: { id: true, name: true, type: true, version: true } },
} satisfies Prisma.CompanyStaffSelect;

const isUniqueError = (error: unknown): boolean => (
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
);

export const companyStaffRepository = {
  async list(input: ListCompanyStaffInput, officeBranchId: string) {
    const query = buildListQuery(input, {
      filters: {
        companyId: (companyId) => ({ companyId }), title: (title) => ({ title }),
        search: (search) => ({ OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { telp: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ] }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListCompanyStaffInput['sortBy']>, Prisma.CompanyStaffOrderByWithRelationInput>({
        companyId: (direction) => ({ companyId: direction }), name: (direction) => ({ name: direction }),
        title: (direction) => ({ title: direction }), version: (direction) => ({ version: direction }),
        updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    const where = { AND: [{ revoked: false }, { company: { officeBranchId, revoked: false } }, query.where] } satisfies Prisma.CompanyStaffWhereInput;
    const [staffs, total] = await Promise.all([
      prisma.companyStaff.findMany({ ...query, where, select }),
      prisma.companyStaff.count({ where }),
    ]);
    return { staffs, pagination: buildPagination(input.page, input.limit, total) };
  },

  findById: (id: string, officeBranchId: string) => prisma.companyStaff.findFirst({
    where: { id, revoked: false, company: { officeBranchId, revoked: false } }, select,
  }),

  findByNormalizeName: (normalizeName: string, officeBranchId: string, excludeId?: string) => prisma.companyStaff.findFirst({
    where: { normalizeName, revoked: false, company: { officeBranchId, revoked: false }, ...(excludeId && { id: { not: excludeId } }) },
    select: { id: true },
  }),


  async create(data: CreateCompanyStaffInput & { normalizeName: string }, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async (tx) => {
      await lockCompanyBranch(tx, officeBranchId);
      const parent = await tx.company.findFirst({ where: { id: data.companyId, officeBranchId, revoked: false } });
      if (!parent) throw new HttpError('Company not found or inactive', 404);
      const duplicate = await tx.companyStaff.findFirst({ where: { normalizeName: data.normalizeName, revoked: false, company: { officeBranchId, revoked: false } } });
      if (duplicate) throw new HttpError('Company staff name already exists', 409);
      const created = await tx.companyStaff.create({ data: { ...data, createdById: actor.id, version: 0 }, select });
      await recordCompanyAudit(tx, officeBranchId, 'COMPANY_STAFF', created.id, 'CREATE', null, created, actor);
      return created;
    });
  },

  async update(id: string, officeBranchId: string, data: UpdateCompanyStaffInput & { normalizeName?: string }, actor: AuditActor) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockCompanyBranch(tx, officeBranchId);
        const current = await tx.companyStaff.findFirst({ where: { id, company: { officeBranchId } }, select });
        if (!current) throw new HttpError('Company staff not found', 404);
        requireCurrentVersion(current, data.version);
        const parent = await tx.company.findFirst({ where: { id: data.companyId ?? current.companyId, officeBranchId, revoked: false } });
        if (!parent) throw new HttpError('Company not found or inactive', 409);
        const duplicate = await tx.companyStaff.findFirst({
          where: { id: { not: id }, normalizeName: data.normalizeName ?? current.normalizeName, revoked: false, company: { officeBranchId, revoked: false } },
        });
        if (duplicate) throw new HttpError('Company staff name already exists', 409);
        const { version, ...changes } = data;
        const updated = await tx.companyStaff.update({
          where: { id, version, revoked: false },
          data: { ...changes, version: { increment: 1 }, updatedById: actor.id }, select,
        });
        await recordCompanyAudit(tx, officeBranchId, 'COMPANY_STAFF', id, 'UPDATE', current, updated, actor);
        return updated;
      });
    } catch (error) {
      if (isUniqueError(error)) throw new HttpError('Company staff name already exists', 409);
      throw error;
    }
  },

  revoke(id: string, officeBranchId: string, version: number, actor: AuditActor) {
    return prisma.$transaction(async (tx) => {
      await lockCompanyBranch(tx, officeBranchId);
      const current = await tx.companyStaff.findFirst({ where: { id, company: { officeBranchId } }, select });
      if (!current) throw new HttpError('Company staff not found', 404);
      requireCurrentVersion(current, version);
      const updated = await tx.companyStaff.update({
        where: { id, version, revoked: false },
        data: { revoked: true, version: { increment: 1 }, updatedById: actor.id }, select,
      });
      await recordCompanyAudit(tx, officeBranchId, 'COMPANY_STAFF', id, 'DEACTIVATE', current, updated, actor);
      return updated;
    });
  },
};
