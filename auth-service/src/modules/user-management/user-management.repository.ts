import { Prisma, User, UserRole, UserSection } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { ListUsersInput } from './user-management.schemas.js';

const select = {
  id: true, username: true, firstName: true, lastName: true, email: true, telp: true, role: true, section: true,
  officeBranchId: true, officeBranchName: true, isActive: true, version: true, createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;

export type ManagedUser = Prisma.UserGetPayload<{ select: typeof select }>;

/**
 * The projection returned to a caller that is not an app manager.
 *
 * It exposes the contact details and the assignment of a user, but not the
 * account metadata: the username, the branch id, the version, and the
 * activation state are all omitted.
 */
const summarySelect = {
  id: true, firstName: true, lastName: true, email: true, telp: true, role: true, section: true,
  officeBranchName: true,
} satisfies Prisma.UserSelect;

export type ManagedUserSummary = Prisma.UserGetPayload<{ select: typeof summarySelect }>;

/**
 * The visibility scope of a list request.
 *
 * An app manager sees every user of every branch, including the deactivated
 * ones. Any other caller sees only the active users of their own branch, and
 * only the summary projection.
 */
export interface UserListScope {
  isAppManager: boolean;
  officeBranchId: string | null;
}

export const userManagementRepository = {
  async list(input: ListUsersInput, scope: UserListScope) {
    // The branch and the activation filter are part of the response of a
    // non-app-manager caller, so a client-supplied value for either of them
    // cannot widen the scope: the filter is overridden, not merged.
    const scopedInput = scope.isAppManager
      ? input
      : { ...input, officeBranchId: undefined, isActive: undefined };
    const query = buildListQuery(scopedInput, {
      filters: {
        role: (role) => ({ role }),
        section: (section) => ({ section }),
        officeBranchId: (officeBranchId) => ({ officeBranchId }),
        isActive: (isActive) => ({ isActive }),
        search: (search) => ({ OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ] }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListUsersInput['sortBy']>, Prisma.UserOrderByWithRelationInput>({
        username: (direction) => ({ username: direction }),
        firstName: (direction) => ({ firstName: direction }),
        lastName: (direction) => ({ lastName: direction }),
        role: (direction) => ({ role: direction }),
        section: (direction) => ({ section: direction }),
        officeBranchId: (direction) => ({ officeBranchId: direction }),
        isActive: (direction) => ({ isActive: direction }),
        updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    // A non-app-manager caller is scoped to their own branch and to the active
    // users only. A caller without a branch assignment has no branch to scope
    // to, so the list stays empty for them. The empty case is handled here
    // rather than with a null branch filter, because a null filter matches the
    // users without a branch instead of matching nothing.
    if (!scope.isAppManager && !scope.officeBranchId) {
      return { users: [], pagination: buildPagination(input.page, input.limit, 0) };
    }
    const where = scope.isAppManager
      ? query.where
      : { AND: [{ officeBranchId: scope.officeBranchId as string }, { isActive: true }, query.where] } satisfies Prisma.UserWhereInput;
    const projection = scope.isAppManager ? select : summarySelect;
    const [users, total] = await Promise.all([
      prisma.user.findMany({ ...query, where, select: projection }),
      prisma.user.count({ where }),
    ]);
    return { users, pagination: buildPagination(input.page, input.limit, total) };
  },
  findById: (userId: string) => prisma.user.findUnique({ where: { id: userId }, select }),
  async lockById(tx: Prisma.TransactionClient, userId: string): Promise<User | null> {
    const rows = await tx.$queryRaw<User[]>`
      SELECT id, username, normalize_username as "normalizeUsername", first_name as "firstName",
        last_name as "lastName", email, telp, role, section, office_branch_id as "officeBranchId",
        office_branch_name as "officeBranchName",
        is_active as "isActive", version,
        created_at as "createdAt", updated_at as "updatedAt"
      FROM "users" WHERE id = ${userId}::uuid FOR UPDATE
    `;
    return rows[0] ?? null;
  },
  lockInvariant: (tx: Prisma.TransactionClient) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('app_manager_invariant'))`,
  countActiveAppManagers: (tx: Prisma.TransactionClient) => tx.user.count({ where: { role: UserRole.APP_MANAGER, isActive: true } }),
  async update(tx: Prisma.TransactionClient, userId: string, version: number, data: {
    role?: UserRole;
    section?: UserSection | null;
    officeBranchId?: string | null;
    officeBranchName?: string | null;
    email?: string | null;
    telp?: string | null;
    isActive?: boolean;
  }): Promise<ManagedUser> {
    const result = await tx.user.updateMany({ where: { id: userId, version }, data: { ...data, version: { increment: 1 } } });
    if (result.count === 0) throw new HttpError('Concurrent update detected. Reload the user and try again.', 409);
    return tx.user.findUniqueOrThrow({ where: { id: userId }, select });
  },
  revokeRefreshTokens: (tx: Prisma.TransactionClient, userId: string) => tx.refreshToken.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } }),
};
