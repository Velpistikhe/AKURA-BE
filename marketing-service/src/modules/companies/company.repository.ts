
import { normalizeName } from '../../utils/normalizeName.js';
import { lockCompanyBranch, saveCompanyStaffHistory, requireCurrentVersion } from '../../utils/companyAudit.js';
import { CompanyType, Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { CreateCompanyInput, ListCompaniesInput, UpdateCompanyInput } from './company.schemas.js';
import { AuditActor } from '../../types/auth.types.js';

const select = {
  createdById: true, updatedById: true,
  id: true, npwp: true, officeBranchId: true, name: true, normalizeName: true, type: true, address: true,
  isSisterCompany: true, revoked: true, version: true, createdAt: true, updatedAt: true,
  _count: { select: { staffs: { where: { revoked: false } } } },
} satisfies Prisma.CompanySelect;

const selectWithContract = () => ({
  ...select,
  contracts: {
    where: {
      status: 'ACTIVE',
      isActive: true,
    },
    orderBy: { effectiveFrom: 'asc' as const },
    take: 1,
    include: { _count: { select: { prices: true } } },
  },
} satisfies Prisma.CompanySelect);

const withCurrentContract = ({ contracts, ...company }: Prisma.CompanyGetPayload<{ select: ReturnType<typeof selectWithContract> }>) => ({
  ...company,
  contract: company.revoked || !contracts[0] ? null : (() => {
    const { _count, ...contract } = contracts[0];
    return { ...contract, hasList: _count.prices > 0 };
  })(),
});

const saveHistory = async (tx: Prisma.TransactionClient, companyId: string, actor: AuditActor, action: string) => {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
  await tx.companyHistory.create({ data: {
    companyId, version: company.version, action, snapshot: JSON.parse(JSON.stringify(company)), createdById: actor.id, createdByName: actor.name,
  } });
};
export const companyRepository = {
  async list(input: ListCompaniesInput, officeBranchId: string) {
    const query = buildListQuery(input, {
      filters: {
        isSisterCompany: (isSisterCompany) => ({ isSisterCompany }),
        search: (search) => ({ OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { type: { in: Object.values(CompanyType).filter((type) => type.toLowerCase().includes(search.toLowerCase())) } },
          { address: { contains: search, mode: 'insensitive' } },
        ] }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListCompaniesInput['sortBy']>, Prisma.CompanyOrderByWithRelationInput>({
        name: (direction) => ({ name: direction }), type: (direction) => ({ type: direction }),
        address: (direction) => ({ address: direction }), isSisterCompany: (direction) => ({ isSisterCompany: direction }),
        version: (direction) => ({ version: direction }), updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    const where = { AND: [{ officeBranchId, revoked: false }, query.where] } satisfies Prisma.CompanyWhereInput;
    const [companies, total] = await Promise.all([
      prisma.company.findMany({ ...query, where, select: selectWithContract() }),
      prisma.company.count({ where }),
    ]);
    return { companies: companies.map(withCurrentContract), pagination: buildPagination(input.page, input.limit, total) };
  },

  findById: (id: string, officeBranchId: string) => prisma.company.findFirst({
    where: { id, officeBranchId, revoked: false }, select: selectWithContract(),
  }).then(company => company ? withCurrentContract(company) : null),

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
      await saveHistory(tx, created.id, actor, 'CREATE');
      return { ...created, contract: null };
    });
  },

  async update(id: string, officeBranchId: string, data: UpdateCompanyInput, actor: AuditActor) {
    return prisma.$transaction(async tx => {
      await lockCompanyBranch(tx, officeBranchId);
      const current = await tx.company.findFirst({ where: { id, officeBranchId } });
      if (!current) throw new HttpError('Company not found', 404);
      requireCurrentVersion(current, data.version);
      const normalized = normalizeName(data.name ?? current.name);
      if (await tx.company.findFirst({ where: { normalizeName: normalized, officeBranchId, revoked: false, id: { not: id } } })) {
        throw new HttpError('Company name already exists', 409);
      }
      const { version, ...changes } = data;
      await tx.company.update({ where: { id, version, revoked: false }, data: {
        ...changes, normalizeName: normalized, version: { increment: 1 }, updatedById: actor.id,
      } });
      await saveHistory(tx, id, actor, 'UPDATE');
      return withCurrentContract(await tx.company.findUniqueOrThrow({ where: { id }, select: selectWithContract() }));
    });
  },

  history: (id: string, officeBranchId: string, input: { page: number; limit: number }) => prisma.$transaction(async tx => {
    if (!await tx.company.findFirst({ where: { id, officeBranchId }, select: { id: true } })) throw new HttpError('Company not found', 404);
    const where = { companyId: id };
    const history = await tx.companyHistory.findMany({ where, orderBy: { version: 'desc' }, skip: (input.page - 1) * input.limit, take: input.limit });
    const total = await tx.companyHistory.count({ where });
    return { companyId: id, history, pagination: buildPagination(input.page, input.limit, total) };
  }, { isolationLevel: 'RepeatableRead' }),

  staffHistory: (id: string, officeBranchId: string, input: { page: number; limit: number }) => prisma.$transaction(async tx => {
    if (!await tx.company.findFirst({ where: { id, officeBranchId }, select: { id: true } })) throw new HttpError('Company not found', 404);
    const where = { companyStaff: { companyId: id } } satisfies Prisma.CompanyStaffHistoryWhereInput;
    const history = await tx.companyStaffHistory.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
    });
    const total = await tx.companyStaffHistory.count({ where });
    return { companyId: id, history, pagination: buildPagination(input.page, input.limit, total) };
  }, { isolationLevel: 'RepeatableRead' }),

  revoke(id: string, officeBranchId: string, version: number, actor: AuditActor) {
    return prisma.$transaction(async (tx) => {
      await lockCompanyBranch(tx, officeBranchId);
      const current = await tx.company.findFirst({
        where: { id, officeBranchId }, include: { staffs: { where: { revoked: false } } },
      });
      if (!current) throw new HttpError('Company not found', 404);
      requireCurrentVersion(current, version);
      for (const staff of current.staffs) {
        await tx.companyStaff.update({
          where: { id: staff.id }, data: { revoked: true, version: { increment: 1 }, updatedById: actor.id },
        });
        await saveCompanyStaffHistory(tx, staff.id, actor, 'DEACTIVATE');
      }
      const updated = await tx.company.update({
        where: { id, officeBranchId, version, revoked: false },
        data: { revoked: true, version: { increment: 1 }, updatedById: actor.id }, select,
      });
      await saveHistory(tx, id, actor, 'DEACTIVATE');
      return { ...updated, contract: null };
    });
  },
};
