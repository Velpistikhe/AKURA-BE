import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { HttpError } from './httpError.js';

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
 * The actor behind the current request.
 *
 * The identity comes from the gateway-verified headers, so it cannot be
 * spoofed by the client. The name is stored next to the id in the audit
 * trail, so the trail still names the person when the user record changes.
 */
export const getAuditActor = (res: Response): AuditActor => {
  const user = res.locals.authUser;
  if (!user) throw new HttpError('Authenticated user is required', 401);
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
    || user.username
    || user.id;
  return { id: user.id, name };
};

/** The modules that write to the audit trail. */
export type AuditModule = 'menu' | 'reference';

/** The entities that write to the audit trail. */
export type AuditEntity =
  | 'MENU'
  | 'MENU_ITEM'
  | 'MENU_ACCESS'
  | 'OFFICE_BRANCH';

/** The action that produced an audit entry. */
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'DEACTIVATE' | 'ACTIVATE';

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
