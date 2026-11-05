import { env } from '../../config/env.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { recordAudit, type AuditActor } from '../../utils/audit.js';
import { HttpError } from '../../utils/httpError.js';
import { createTaxSchema } from './tax.schemas.js';

export const taxRepository = {
  async create(input: unknown, officeBranchId: string, actor: AuditActor) {
    const { tax } = await this.createWithEvent(input, officeBranchId, actor);
    return tax;
  },
  async createWithEvent(input: unknown, officeBranchId: string, actor: AuditActor) {
    const { percentage, effectiveFrom } = createTaxSchema.parse(input);
    return prisma.$transaction(async tx => {
      // Also serializes the first insertion, when no tax row exists yet.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tax-branch:' + officeBranchId}))`;
      const latest = await tx.tax.findFirst({ where: { officeBranchId }, orderBy: { effectiveFrom: 'desc' } });
      if (latest && effectiveFrom.getTime() <= latest.effectiveFrom.getTime()) {
        throw new HttpError('Tax effectiveFrom must be later than the latest tax effectiveFrom in this branch', 409);
      }
      // Closing the previous period and opening the new one are two separate
      // changes to two separate rows, so each gets its own audit entry.
      if (latest) {
        const closed = await tx.tax.update({ where: { id: latest.id }, data: {
          effectiveUntil: new Date(effectiveFrom.getTime() - 86400000), updatedById: actor.id, updatedByName: actor.name,
        } });
        await recordAudit(tx, {
          module: 'taxes',
          entityType: 'TAX',
          entityId: closed.id,
          version: closed.updatedAt.getTime(),
          action: 'CLOSE_PERIOD',
          before: latest,
          after: closed,
          officeBranchId,
          actor,
        });
      }
      const tax = await tx.tax.create({ data: {
        officeBranchId, percentage: new Prisma.Decimal(percentage), effectiveFrom,
        createdById: actor.id, createdByName: actor.name,
      } });
      // The audit entry is written in the same transaction as the tax row, so
      // the trail can never show a tax that was not committed.
      await recordAudit(tx, {
        module: 'taxes',
        entityType: 'TAX',
        entityId: tax.id,
        version: tax.updatedAt.getTime(),
        action: 'CREATE',
        before: null,
        after: tax,
        officeBranchId,
        actor,
      });
      const event = await enqueueTaxSnapshot(tx, officeBranchId);
      return { tax, event };
    }, { maxWait: 10000, timeout: 20000 });
  },
};

export async function enqueueTaxSnapshot(tx: Prisma.TransactionClient, officeBranchId: string) {
  const revision = await tx.taxRevision.upsert({ where: { officeBranchId }, create: { officeBranchId, version: 1 }, update: { version: { increment: 1 } } });
  const taxes = await tx.tax.findMany({ where: { officeBranchId }, orderBy: { effectiveFrom: 'asc' },
    select: { id: true, officeBranchId: true, percentage: true, effectiveFrom: true, effectiveUntil: true, updatedAt: true } });
  return tx.taxEvent.create({ data: { officeBranchId, version: revision.version,
    payload: JSON.parse(JSON.stringify(taxes)),
    deliveries: { create: env.TAX_DELIVERY_TARGETS.map(target => ({ targetService: target.name })) } } });
}
export async function applicableTax(tx: Prisma.TransactionClient, officeBranchId: string, day: Date) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tax-branch:' + officeBranchId}))`;
  const tax = await tx.tax.findFirst({ where: { officeBranchId, effectiveFrom: { lte: day },
    OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: day } }] }, orderBy: { effectiveFrom: 'desc' } });
  if (!tax) throw new HttpError('No Finance tax is configured for this branch and document date', 409);
  return tax;
}
