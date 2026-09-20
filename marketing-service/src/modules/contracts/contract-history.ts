import { Prisma } from '@prisma/client';
import { AuditActor } from '../../types/auth.types.js';

export const recordContractHistory = (
  tx: Prisma.TransactionClient,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> & { id: string; version: number },
  actor: AuditActor,
  action: string,
) => {
  const changedFields = before
    ? Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    : Object.keys(after);
  return tx.companyContractHistory.create({ data: {
    companyContractId: after.id,
    version: after.version,
    action,
    snapshot: JSON.parse(JSON.stringify({ oldData: before, newData: after, changedFields })),
    createdById: actor.id,
    createdByName: actor.name,
  } });
};
