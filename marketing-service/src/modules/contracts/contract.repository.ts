import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { recordCatalogAudit, requireCatalogVersion } from '../../utils/catalogAudit.js';
import { currentBusinessDate } from '../../utils/businessDate.js';
import { recordContractHistory } from './contract-history.js';

import { ContractPeriod, CreateContractInput, ListContractsInput } from './contract.schemas.js';

const company = async (tx: Prisma.TransactionClient, id: string, branch: string) => {
  const row = await tx.company.findFirst({ where: { id, officeBranchId: branch, revoked: false } });
  if (!row) throw new HttpError('Company not found', 404);
  return row;
};
const saveHistory = (tx: Prisma.TransactionClient, before: Record<string, unknown> | null, contract: { id: string; version: number }, actor: AuditActor, action: string) =>
  recordContractHistory(tx, before, contract, actor, action);

// Contract versions are checked with requireCatalogVersion below.

// A single advisory lock serializes all contract lifecycle writes for a branch.

export const contractRepository = {
  resolveCompanyReference: (companyId: string, branch: string) => prisma.$transaction(async tx => {
    await company(tx, companyId, branch);
    const today = currentBusinessDate();
    const contracts = await tx.companyContract.findMany({
      where: { companyId, status: 'APPROVED', effectiveFrom: { lte: today }, effectiveUntil: { gt: today },
        company: { officeBranchId: branch, revoked: false } },
      include: { company: true, prices: { where: { isActive: true } } },
      take: 2,
    });
      if (!contracts.length) throw new HttpError('Company has no APPROVED contract within its effective period', 409);
      if (contracts.length !== 1) throw new HttpError('Company has multiple effective contracts; resolve the conflict before creating a work order', 409);
    return contracts[0];
  }, { isolationLevel: 'RepeatableRead' }),
  list: async (input: ListContractsInput, branch: string) => prisma.$transaction(async tx => {
    if (input.companyId) await company(tx, input.companyId, branch);
    const where = { ...(input.companyId ? { companyId: input.companyId } : {}), status: input.status, company: { officeBranchId: branch, revoked: false } } satisfies Prisma.CompanyContractWhereInput;
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
  create: (data: CreateContractInput, branch: string, actor: AuditActor, _isAdmin: boolean) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const owner = await company(tx, data.companyId, branch);
    const existing = await tx.companyContract.findFirst({ where: { companyId: data.companyId, status: { in: ['DRAFT', 'APPROVED'] }, effectiveUntil: { gt: currentBusinessDate() } } });
    if (existing) throw new HttpError('The company already has a draft or approved contract', 409);
    const row = await tx.companyContract.create({ data: { ...data, status: 'DRAFT', companySnapshot: JSON.parse(JSON.stringify(owner)), createdById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', null, row, actor, 'CREATE');
    await saveHistory(tx, null, row, actor, 'CREATE');
    return row;
  }),
  approve: (id: string, version: number, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (before.status !== 'DRAFT') throw new HttpError('Only contracts with DRAFT status can be approved', 409);
    if (before.effectiveUntil <= currentBusinessDate()) throw new HttpError('Expired contracts cannot be approved', 409);
    const conflict = await tx.companyContract.findFirst({ where: { companyId: before.companyId, id: { not: id }, status: 'APPROVED', effectiveFrom: { lt: before.effectiveUntil }, effectiveUntil: { gt: before.effectiveFrom } } });
    if (conflict) throw new HttpError('Approved contract period overlaps another approved contract', 409);
    const after = await tx.companyContract.update({ where: { id, version }, data: { status: 'APPROVED', version: { increment: 1 }, updatedById: actor.id } });
    if (before.revisionOfId) {
      const old = await tx.companyContract.findUniqueOrThrow({ where: { id: before.revisionOfId } });
      const oldUntil = new Date(before.effectiveFrom); oldUntil.setUTCDate(oldUntil.getUTCDate() - 1);
      const oldAfter = await tx.companyContract.update({ where: { id: old.id, version: old.version }, data: { status: 'REVISED', effectiveUntil: oldUntil, version: { increment: 1 }, updatedById: actor.id } });
      await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', old, oldAfter, actor, 'REVISED');
      await saveHistory(tx, old, oldAfter, actor, 'REVISED');
    }
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'APPROVE');
    await saveHistory(tx, before, after, actor, 'APPROVE');
    return after;
  }),
  update: (id: string, data: ContractPeriod, branch: string, actor: AuditActor, isAdmin = true) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, data.version);
    if (before.status === 'APPROVED' && !isAdmin) throw new HttpError('Only marketing admin can update approved contracts', 403);
    if (!['DRAFT', 'APPROVED'].includes(before.status)) throw new HttpError('Contract status cannot be updated', 409);
    if (before.status === 'APPROVED') {
      const conflict = await tx.companyContract.findFirst({ where: { companyId: before.companyId, id: { not: id }, status: { in: ['APPROVED', 'TERMINATED'] }, effectiveFrom: { lt: data.effectiveUntil }, effectiveUntil: { gt: data.effectiveFrom } } });
      if (conflict) throw new HttpError('Contract period overlaps another contract', 409);
    }
    const after = await tx.companyContract.update({ where: { id, version: data.version }, data: {
      contractNumber: data.contractNumber, contractDate: data.contractDate,
      effectiveFrom: data.effectiveFrom, effectiveUntil: data.effectiveUntil,
      updatedById: actor.id, version: { increment: 1 },
    } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'UPDATE');
    await saveHistory(tx, before, after, actor, 'UPDATE');
    return after;
  }),
  revise: (id: string, data: ContractPeriod, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, data.version);
    if (before.status !== 'APPROVED') throw new HttpError('Only approved contracts can be revised', 409);
    const approved = await tx.companyContract.findFirst({ where: { companyId: before.companyId, status: 'APPROVED', effectiveUntil: { gt: currentBusinessDate() } } });
    if (!approved) throw new HttpError('No current or future approved contract exists', 409);
    const period = data;
    const existing = await tx.companyContract.findMany({ where: {
      companyId: before.companyId, status: { in: ['APPROVED'] },
    } });
    if (existing.some(contract => contract.contractNumber.trim() === period.contractNumber.trim())) {
      throw new HttpError('Revised contract must use a different contract number', 409);
    }
    const closedUntil = new Date(period.effectiveFrom);
    closedUntil.setUTCDate(closedUntil.getUTCDate() - 1);
    // Close legacy duplicates as well, including contracts that have not started yet.
    for (const contract of existing) {
      const isFuture = contract.effectiveFrom > currentBusinessDate();
      const data = isFuture
        ? { status: 'CANCELED' as const, version: { increment: 1 }, updatedById: actor.id }
        : { status: 'APPROVED' as const, effectiveUntil: closedUntil, version: { increment: 1 }, updatedById: actor.id };
      const closed = await tx.companyContract.update({ where: { id: contract.id, version: contract.version }, data });
      await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', contract, closed, actor, 'REVISED');
      await saveHistory(tx, contract, closed, actor, 'REVISED');
    }
    const row = await tx.companyContract.create({ data: {
      companyId: before.companyId, contractNumber: data.contractNumber, contractDate: data.contractDate,
      effectiveFrom: data.effectiveFrom, effectiveUntil: data.effectiveUntil, status: 'DRAFT',
      companySnapshot: before.companySnapshot ?? Prisma.DbNull, revisionOfId: before.id, createdById: actor.id,
    } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', null, row, actor, 'REVISE');
    await saveHistory(tx, null, row, actor, 'REVISE');
    return row;
  }),
  terminate: (id: string, version: number, terminatedAt: Date, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (before.status !== 'APPROVED') throw new HttpError('Only approved contracts can be terminated', 409);
    if (terminatedAt <= before.effectiveFrom || terminatedAt > before.effectiveUntil) throw new HttpError('terminatedAt must be after effectiveFrom and not after effectiveUntil', 400);
    const after = await tx.companyContract.update({ where: { id, version }, data: { status: 'TERMINATED', effectiveUntil: terminatedAt, version: { increment: 1 }, updatedById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'DEACTIVATE');
    await saveHistory(tx, before, after, actor, 'TERMINATE');
    return after;
  }),
  delete: (id: string, version: number, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (before.status !== 'DRAFT') throw new HttpError('Only DRAFT contracts can be deleted', 409);
    const after = await tx.companyContract.update({ where: { id, version }, data: { status: 'CANCELED', version: { increment: 1 }, updatedById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'DELETE');
    await saveHistory(tx, before, after, actor, 'DELETE');
    return after;
  }),
};
