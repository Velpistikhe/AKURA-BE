import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { CreateCompanyStaffInput, ListCompanyStaffInput, UpdateCompanyStaffInput } from './company-staff.schemas.js';

const select = {
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

  async create(data: CreateCompanyStaffInput & { normalizeName: string }) {
    try {
      return await prisma.companyStaff.create({ data: { ...data, revoked: false, version: 0 }, select });
    } catch (error) {
      if (isUniqueError(error)) throw new HttpError('Company staff name already exists', 409);
      throw error;
    }
  },

  async update(id: string, officeBranchId: string, data: UpdateCompanyStaffInput & { normalizeName?: string }) {
    try {
      return await prisma.companyStaff.update({ where: { id, company: { officeBranchId } }, data, select });
    } catch (error) {
      if (isUniqueError(error)) throw new HttpError('Company staff name already exists', 409);
      throw error;
    }
  },

  revoke(id: string, officeBranchId: string) {
    return prisma.companyStaff.update({
      where: { id, company: { officeBranchId } }, data: { revoked: true, version: { increment: 1 } }, select,
    });
  },
};
