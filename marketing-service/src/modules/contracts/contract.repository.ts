import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { recordCatalogAudit, requireCatalogVersion } from '../../utils/catalogAudit.js';
import { currentBusinessDate } from '../../utils/businessDate.js';
import { ContractPeriod, CreateContractInput, ListContractsInput } from './contract.schemas.js';

const company = async (tx: Prisma.TransactionClient, id: string, branch: string) => {
  const row = await tx.company.findFirst({ where: { id, officeBranchId: branch, revoked: false } });
  if (!row) throw new HttpError('Company not found', 404);
  return row;
};
const saveHistory = (tx: Prisma.TransactionClient, contract: { id: string; version: number }, actor: AuditActor, action: string) =>
  tx.companyContractHistory.create({ data: {
    companyContractId: contract.id, version: contract.version, action,
    snapshot: JSON.parse(JSON.stringify(contract)), createdById: actor.id, createdByName: actor.name,
  } });

const checkOverlap = async (tx: Prisma.TransactionClient, companyId: string, from: Date, until: Date, id?: string) => {
  const conflict = await tx.companyContract.findFirst({ where: {
    companyId, isActive: true, status: 'ACTIVE', ...(id ? { id: { not: id } } : {}),
    effectiveFrom: { lt: until }, effectiveUntil: { gt: from },
  } });
  if (conflict) throw new HttpError('An active contract overlaps this company contract period', 409);
};
const ensureNoActiveContract = async (tx: Prisma.TransactionClient, companyId: string) => {
  const active = await tx.companyContract.findFirst({ where: { companyId, status: 'ACTIVE', isActive: true } });
  if (active) throw new HttpError('The company already has an active contract', 409);
};
export const contractRepository = {
  resolveCompanyReference: (companyId: string, branch: string) => prisma.$transaction(async tx => {
    await company(tx, companyId, branch);
    const today = currentBusinessDate();
    const contracts = await tx.companyContract.findMany({
      where: { companyId, isActive: true, status: 'ACTIVE', effectiveFrom: { lte: today }, effectiveUntil: { gt: today },
        company: { officeBranchId: branch, revoked: false } },
      include: { company: true, prices: { where: { isActive: true } } },
      take: 2,
    });
    if (!contracts.length) throw new HttpError('Company has no ACTIVE contract within its effective period', 409);
    if (contracts.length !== 1) throw new HttpError('Company has multiple effective contracts; resolve the conflict before creating a work order', 409);
    return contracts[0];
  }, { isolationLevel: 'RepeatableRead' }),
  list: async (input: ListContractsInput, branch: string) => prisma.$transaction(async tx => {
    if (input.companyId) await company(tx, input.companyId, branch);
    const where = { ...(input.companyId ? { companyId: input.companyId } : {}), isActive: input.isActive, status: input.status, company: { officeBranchId: branch, revoked: false } } satisfies Prisma.CompanyContractWhereInput;
    const contracts = await tx.companyContract.findMany({ where, orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }], skip: (input.page - 1) * input.limit, take: input.limit, include: { _count: { select: { prices: true } } } });
    const total = await tx.companyContract.count({ where });
    return { contracts: contracts.map(({ _count, ...contract }) => ({ ...contract, hasList: _count.prices > 0 })), pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } };
  }, { isolationLevel: 'RepeatableRead' }),
  get: async (id: string, branch: string) => {
    const contract = await prisma.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } }, include: { _count: { select: { prices: true } } } });
    if (!contract) throw new HttpError('Company contract not found', 404);
    const { _count, ...data } = contract;
    return { ...data, hasList: _count.prices > 0 };
  },
  create: (data: CreateContractInput, branch: string, actor: AuditActor, isAdmin: boolean) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    await company(tx, data.companyId, branch);
    await ensureNoActiveContract(tx, data.companyId);
    const status = isAdmin ? 'ACTIVE' : 'CREATE';
    if (status === 'ACTIVE') await checkOverlap(tx, data.companyId, data.effectiveFrom, data.effectiveUntil);
    const row = await tx.companyContract.create({ data: { ...data, status, createdById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', null, row, actor, 'CREATE');
    await saveHistory(tx, row, actor, 'CREATE');
    return row;
  }),
  approve: (id: string, version: number, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (before.status !== 'CREATE') throw new HttpError('Only contracts with CREATE status can be approved', 409);
    if (before.effectiveUntil <= currentBusinessDate()) throw new HttpError('Expired contracts cannot be approved', 409);
    await checkOverlap(tx, before.companyId, before.effectiveFrom, before.effectiveUntil, id);
    const after = await tx.companyContract.update({ where: { id, version }, data: { status: 'ACTIVE', version: { increment: 1 }, updatedById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'APPROVE');
    await saveHistory(tx, after, actor, 'APPROVE');
    return after;
  }),
  revise: (id: string, data: ContractPeriod, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, data.version);
    if (before.status !== 'ACTIVE') throw new HttpError('Only active contracts can be revised', 409);
    const period = data as ContractPeriod;
    const closedUntil = new Date(period.effectiveFrom);
    closedUntil.setUTCDate(closedUntil.getUTCDate() - 1);
    if (closedUntil <= before.effectiveFrom) throw new HttpError('New effectiveFrom must be at least two days after the current contract starts', 400);
    await checkOverlap(tx, before.companyId, period.effectiveFrom, period.effectiveUntil, id);
    const closed = await tx.companyContract.update({ where: { id, version: data.version }, data: { status: 'TERMINATED', isActive: false, effectiveUntil: closedUntil, version: { increment: 1 }, updatedById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, closed, actor, 'REVISE');
    await saveHistory(tx, closed, actor, 'REVISE');
    const replacement = await tx.companyContract.create({ data: {
      companyId: before.companyId, contractNumber: period.contractNumber ?? before.contractNumber, contractDate: period.contractDate ?? before.contractDate,
      effectiveFrom: period.effectiveFrom, effectiveUntil: period.effectiveUntil, status: 'ACTIVE', createdById: actor.id,
    } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', null, replacement, actor, 'REVISE');
    await saveHistory(tx, replacement, actor, 'REVISE');
    return replacement;
  }),
  deactivate: (id: string, version: number, terminatedAt: Date, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (terminatedAt <= before.effectiveFrom) throw new HttpError('terminatedAt must be after effectiveFrom', 400);
    const after = await tx.companyContract.update({ where: { id, version }, data: { status: 'TERMINATED', isActive: false, effectiveUntil: terminatedAt, version: { increment: 1 }, updatedById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'DEACTIVATE');
    await saveHistory(tx, after, actor, 'DEACTIVATE');
    return after;
  }),
};
