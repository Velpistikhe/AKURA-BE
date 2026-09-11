import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { recordCatalogAudit, requireCatalogVersion } from '../../utils/catalogAudit.js';
import { ContractPeriod, CreateContractInput, ListContractsInput } from './contract.schemas.js';

const company = async (tx: Prisma.TransactionClient, id: string, branch: string) => {
  const row = await tx.company.findFirst({ where: { id, officeBranchId: branch, revoked: false } });
  if (!row) throw new HttpError('Company not found', 404);
  return row;
};
const checkOverlap = async (tx: Prisma.TransactionClient, companyId: string, from: Date, until: Date | null, id?: string) => {
  const conflict = await tx.companyContract.findFirst({ where: {
    companyId, isActive: true, status: 'ACTIVE', ...(id ? { id: { not: id } } : {}),
    ...(until ? { effectiveFrom: { lt: until } } : {}),
    OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: from } }],
  } });
  if (conflict) throw new HttpError('An active contract overlaps this company contract period', 409);
};
export const contractRepository = {
  list: async (input: ListContractsInput, branch: string) => prisma.$transaction(async tx => {
    await company(tx, input.companyId, branch);
    const where = { companyId: input.companyId, isActive: input.isActive, status: input.status };
    const contracts = await tx.companyContract.findMany({ where, orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }], skip: (input.page - 1) * input.limit, take: input.limit });
    const total = await tx.companyContract.count({ where });
    return { contracts, pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } };
  }, { isolationLevel: 'RepeatableRead' }),
  get: async (id: string, branch: string) => {
    const contract = await prisma.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!contract) throw new HttpError('Company contract not found', 404);
    return contract;
  },
  create: (data: CreateContractInput, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    await company(tx, data.companyId, branch);
    if (data.status === 'ACTIVE') await checkOverlap(tx, data.companyId, data.effectiveFrom, data.effectiveUntil);
    const row = await tx.companyContract.create({ data: { ...data, createdById: actor.id, createdByName: actor.name } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', null, row, actor, 'CREATE');
    return row;
  }),
  update: (id: string, data: ContractPeriod | { version: number }, branch: string, actor: AuditActor, remove = false) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, data.version);
    const period = data as ContractPeriod;
    const effectiveFrom = period.effectiveFrom ?? before.effectiveFrom;
    const effectiveUntil = period.effectiveUntil === undefined ? before.effectiveUntil : period.effectiveUntil;
    const status = remove ? 'TERMINATED' : period.status ?? before.status;
    if (!remove && effectiveUntil !== null && effectiveUntil <= effectiveFrom) throw new HttpError('effectiveUntil must be after effectiveFrom', 400);
    if (!remove && status === 'ACTIVE') await checkOverlap(tx, before.companyId, effectiveFrom, effectiveUntil, id);
    const after = await tx.companyContract.update({ where: { id, version: data.version }, data: {
      status, ...(remove ? { isActive: false } : { effectiveFrom, effectiveUntil }),
      version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name,
    } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, remove ? 'DEACTIVATE' : 'UPDATE');
    return after;
  }),
};
