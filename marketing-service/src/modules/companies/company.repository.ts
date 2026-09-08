import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { CreateCompanyInput, ListCompaniesInput, UpdateCompanyInput } from './company.schemas.js';

const select = {
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
          { type: { contains: search, mode: 'insensitive' } },
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

  async create(data: CreateCompanyInput & { normalizeName: string; officeBranchId: string }) {
    try {
      return await prisma.company.create({ data: { ...data, revoked: false, version: 0 }, select });
    } catch (error) {
      if (isUniqueError(error)) throw new HttpError('Company name already exists', 409);
      throw error;
    }
  },

  createVersion(id: string, officeBranchId: string, data: UpdateCompanyInput & { normalizeName: string }) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'company:' + id}))`;
      const current = await tx.company.findFirst({
        where: { id, officeBranchId, revoked: false },
        include: { staffs: { where: { revoked: false } } },
      });
      if (!current) throw new HttpError('Company not found', 404);

      const conflict = await tx.company.findFirst({
        where: { normalizeName: data.normalizeName, officeBranchId, revoked: false, id: { not: id } },
        select: { id: true },
      });
      if (conflict) throw new HttpError('Company name already exists', 409);

      await tx.company.update({ where: { id, officeBranchId }, data: { revoked: true } });
      await tx.companyStaff.updateMany({ where: { companyId: id, revoked: false }, data: { revoked: true } });

      try {
        return await tx.company.create({
          data: {
            officeBranchId,
            name: data.name ?? current.name,
            normalizeName: data.normalizeName,
            type: data.type ?? current.type,
            address: data.address ?? current.address,
            hasContract: data.hasContract ?? current.hasContract,
            revoked: false,
            version: current.version + 1,
            staffs: {
              create: current.staffs.map((staff) => ({
                name: staff.name, normalizeName: staff.normalizeName, title: staff.title,
                telp: staff.telp, email: staff.email, revoked: false, version: 0,
              })),
            },
          },
          select,
        });
      } catch (error) {
        if (isUniqueError(error)) throw new HttpError('Company name or company staff name already exists', 409);
        throw error;
      }
    });
  },

  revoke(id: string, officeBranchId: string) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.company.findFirst({ where: { id, officeBranchId, revoked: false }, select: { id: true } });
      if (!current) throw new HttpError('Company not found', 404);
      await tx.companyStaff.updateMany({ where: { companyId: id, revoked: false }, data: { revoked: true, version: { increment: 1 } } });
      return tx.company.update({ where: { id, officeBranchId }, data: { revoked: true, version: { increment: 1 } }, select });
    });
  },
};
