import { Prisma, User } from '@prisma/client';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/// Full user snapshot delivered to the Marketing and Field Service read models.
export type UserSyncSnapshot = Pick<User,
  'id' | 'username' | 'firstName' | 'lastName' | 'email' | 'telp'
  | 'role' | 'section' | 'officeBranchId' | 'isActive'
  | 'version' | 'createdAt' | 'updatedAt'>;

export type UserSyncTarget = 'marketing-service' | 'fieldservice-service';

export const isMarketingUserSyncCandidate = (user: Pick<UserSyncSnapshot, 'role' | 'section' | 'isActive' | 'officeBranchId'>): boolean =>
  user.role === 'ADMIN' && user.section === 'MARKETING' && user.isActive && Boolean(user.officeBranchId);
export const isFieldServiceUserSyncCandidate = (user: Pick<UserSyncSnapshot, 'section' | 'isActive' | 'officeBranchId'>): boolean =>
  user.section === 'FIELD_SERVICE' && user.isActive && Boolean(user.officeBranchId);

/** Delivery runs only when the gateway and shared credential are configured. */
export const isUserSyncConfigured = (): boolean =>
  Boolean(env.API_GATEWAY_URL && env.USER_SYNC_SECRET);

/**
 * Appends a user snapshot to the outbox in the same transaction as the mutation.
 * The row is written even when delivery is temporarily unconfigured so no state
 * change is ever lost. Marketing always receives the event (it applies an
 * ineligible-event delete); Field Service only receives events for which the
 * previous or resulting snapshot was FIELD_SERVICE-eligible, so losing
 * eligibility is still propagated without flooding unrelated receivers.
 */
export async function enqueueUserSync(
  tx: Prisma.TransactionClient,
  user: UserSyncSnapshot,
  options?: { previous?: Pick<UserSyncSnapshot, 'section' | 'isActive' | 'officeBranchId'> },
): Promise<string> {
  // Serialize an explicit allowlist. Prisma may return internal fields such as
  // normalizeUsername at runtime; they must never leak into the strict sync contract.
  const payload = {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    telp: user.telp,
    role: user.role,
    section: user.section,
    officeBranchId: user.officeBranchId,
    isActive: user.isActive,
    version: user.version,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  } satisfies UserSyncSnapshot;
  const targets: UserSyncTarget[] = ['marketing-service'];
  const previous = options?.previous;
  if (isFieldServiceUserSyncCandidate(user) || (previous && isFieldServiceUserSyncCandidate(previous))) {
    targets.push('fieldservice-service');
  }
  const event = await tx.userSyncEvent.create({
    data: {
      userId: user.id,
      version: user.version,
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      deliveries: { create: targets.map(targetService => ({ targetService })) },
    },
  });
  logger.info('User sync event enqueued', {
    eventId: event.id, userId: user.id, officeBranchId: user.officeBranchId, version: user.version,
    targets, marketingEligible: isMarketingUserSyncCandidate(user),
    fieldServiceEligible: isFieldServiceUserSyncCandidate(user),
  });
  return event.id;
}
