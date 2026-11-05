import { Prisma } from '@prisma/client';

/**
 * The identity of the actor that performed a change.
 *
 * The name is stored next to the id, so the audit trail still names the person
 * when the user record has been removed or renamed since.
 */
export interface AuditActor {
  id: string;
  name: string;
}

/**
 * The actor for a change that no user performed.
 *
 * Events that are replicated from another service (a tax snapshot, a user
 * profile sync) have no user behind them. A fixed sentinel UUID keeps the
 * `createdById` column valid while the name still identifies the service.
 */
export const SYSTEM_ACTOR: AuditActor = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'System',
};

/** The actor for a change performed by a named service. */
export const serviceActor = (name: string): AuditActor => ({
  id: '00000000-0000-4000-8000-000000000001',
  name,
});

/**
 * The modules that write to the audit trail.
 */
export type AuditModule =
  | 'companies'
  | 'company-staff'
  | 'contract-prices'
  | 'contracts'
  | 'items'
  | 'quotations'
  | 'services'
  | 'taxes'
  | 'user-sync';

/** The entities that write to the audit trail. */
export type AuditEntity =
  | 'COMPANY'
  | 'COMPANY_STAFF'
  | 'QUOTATION'
  | 'TAX'
  | 'USER_SYNC';

/** The action that produced an audit entry. */
export type AuditAction = string;

/**
 * Records one audit entry.
 *
 * The write must run inside the same transaction as the change it describes,
 * so the audit trail and the data can never disagree: either both are
 * committed, or neither is.
 *
 * The version makes the entry unique per entity state, so a retried write
 * cannot produce a second entry for the same state.
 */
export const recordAudit = async (
  tx: Prisma.TransactionClient,
  input: {
    module: AuditModule;
    entityType: AuditEntity;
    entityId: string;
    version: number | bigint;
    action: AuditAction;
    before: unknown;
    after: unknown;
    officeBranchId?: string | null;
    actor: AuditActor;
  },
): Promise<void> => {
  await tx.auditLog.create({
    data: {
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      // The audit table stores the version as a BigInt, so a timestamp in
      // milliseconds and a plain counter are both representable.
      version: BigInt(input.version),
      action: input.action,
      before: input.before == null ? Prisma.DbNull : JSON.parse(JSON.stringify(input.before)),
      after: JSON.parse(JSON.stringify(input.after)),
      officeBranchId: input.officeBranchId ?? null,
      createdById: input.actor.id,
      createdByName: input.actor.name,
    },
  });
};