import { Prisma, PrismaClient } from '@prisma/client';
import { Request } from 'express';

export type UserAuditActor = { id: string; name: string };

/** The modules that write to the security audit trail. */
export type SecurityAuditModule = 'auth' | 'user-management' | 'user-sync';

/**
 * The security events that are recorded.
 *
 * The user profile changes live in `UserHistory`. These are the events of the
 * other modules that describe who did what, and when.
 */
export type SecurityEventType =
  | 'REGISTER'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'TOKEN_REFRESH'
  | 'TOKEN_REFRESH_REJECTED'
  | 'LOGOUT'
  | 'PROMOTE'
  | 'DEACTIVATE'
  | 'REACTIVATE'
  | 'USER_SYNC_DELIVERED';

/** Whether the event describes a success or a refusal. */
export type SecurityOutcome = 'SUCCESS' | 'FAILURE';

/** The request context that is recorded next to the event. */
export interface SecurityAuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * The request context that is recorded next to a security event.
 *
 * The address identifies the client that made the request, and the user agent
 * describes the client software. Both are taken from the request, so they
 * cannot be forged by the request body.
 */
export const getAuditContext = (req: Request): SecurityAuditContext => ({
  ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
  userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
});

/**
 * Records one security audit entry.
 *
 * The write runs in the same transaction as the change it describes whenever
 * one exists, so the audit trail and the data cannot disagree. A failed login
 * has no data change to commit, so it is written on its own.
 */
export const saveSecurityAudit = async (
  tx: Prisma.TransactionClient | PrismaClient,
  input: {
    module: SecurityAuditModule;
    eventType: SecurityEventType;
    action: string;
    outcome: SecurityOutcome;
    userId?: string | null;
    username?: string | null;
    officeBranchId?: string | null;
    context?: SecurityAuditContext;
    detail?: unknown;
  },
): Promise<void> => {
  await tx.securityAuditLog.create({
    data: {
      module: input.module,
      eventType: input.eventType,
      action: input.action,
      outcome: input.outcome,
      userId: input.userId ?? null,
      username: input.username ?? null,
      officeBranchId: input.officeBranchId ?? null,
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent?.slice(0, 300) ?? null,
      detail: input.detail == null ? Prisma.DbNull : JSON.parse(JSON.stringify(input.detail)),
    },
  });
};

// Normalizes Prisma rows (officeBranchName) and API rows (branch) so before and
// after snapshots always expose the same field set.
interface UserSnapshotSource {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  telp: string | null;
  role: string;
  section: string | null;
  officeBranchId: string | null;
  officeBranchName?: string | null;
  branch?: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const userSnapshot = (user: UserSnapshotSource): Record<string, unknown> => ({
  id: user.id,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  telp: user.telp,
  role: user.role,
  section: user.section,
  officeBranchId: user.officeBranchId,
  branch: user.branch ?? user.officeBranchName ?? null,
  isActive: user.isActive,
  version: user.version,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export async function saveUserHistory(
  tx: Prisma.TransactionClient | PrismaClient,
  user: UserSnapshotSource,
  before: UserSnapshotSource | null,
  actor: UserAuditActor,
  action: 'CREATE' | 'UPDATE' | 'PASSWORD_CHANGE',
): Promise<void> {
  const beforeSnapshot = before ? userSnapshot(before) : null;
  const snapshot = userSnapshot(user);
  // id, timestamps and version are context, not user-editable data fields.
  const fields = Object.keys(snapshot).filter((field) => !['id', 'createdAt', 'updatedAt', 'version'].includes(field));
  const changes = fields.flatMap((field) => {
    const beforeValue = beforeSnapshot?.[field] ?? null;
    const afterValue = snapshot[field] ?? null;
    return JSON.stringify(beforeValue) === JSON.stringify(afterValue)
      ? []
      : [{ field, before: beforeValue, after: afterValue }];
  });
  // Password material never enters history; the action itself documents the change.
  if (action === 'PASSWORD_CHANGE') {
    changes.push({ field: 'password', before: '[REDACTED]', after: '[REDACTED]' });
  }
  await tx.userHistory.create({ data: {
    userId: user.id,
    version: user.version,
    action,
    beforeSnapshot: beforeSnapshot ? JSON.parse(JSON.stringify(beforeSnapshot)) : Prisma.DbNull,
    snapshot: JSON.parse(JSON.stringify(snapshot)),
    changes: JSON.parse(JSON.stringify(changes)),
    createdById: actor.id,
    createdByName: actor.name,
  } });
}
