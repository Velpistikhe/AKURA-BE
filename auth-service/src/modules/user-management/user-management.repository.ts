import { Prisma, User, UserRole, UserSection } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { ListUsersInput } from './user-management.schemas.js';

const select = {
  id: true, username: true, firstName: true, lastName: true, role: true, section: true,
  isActive: true, version: true, createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;

export type ManagedUser = Prisma.UserGetPayload<{ select: typeof select }>;

export const userManagementRepository = {
  async list(input: ListUsersInput) {
    const query = buildListQuery(input, {
      filters: {
        role: (role) => ({ role }),
        section: (section) => ({ section }),
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
        isActive: (direction) => ({ isActive: direction }),
        updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    const [users, total] = await Promise.all([
      prisma.user.findMany({ ...query, select }),
      prisma.user.count({ where: query.where }),
    ]);
    return { users, pagination: buildPagination(input.page, input.limit, total) };
  },
  findById: (userId: string) => prisma.user.findUnique({ where: { id: userId }, select }),
  async lockById(tx: Prisma.TransactionClient, userId: string): Promise<User | null> {
    const rows = await tx.$queryRaw<User[]>`
      SELECT id, username, normalize_username as "normalizeUsername", first_name as "firstName",
        last_name as "lastName", role, section, is_active as "isActive", version,
        created_at as "createdAt", updated_at as "updatedAt"
      FROM "users" WHERE id = ${userId}::uuid FOR UPDATE
    `;
    return rows[0] ?? null;
  },
  lockInvariant: (tx: Prisma.TransactionClient) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('app_manager_invariant'))`,
  countActiveAppManagers: (tx: Prisma.TransactionClient) => tx.user.count({ where: { role: UserRole.APP_MANAGER, isActive: true } }),
  async update(tx: Prisma.TransactionClient, userId: string, version: number, data: { role?: UserRole; section?: UserSection | null; isActive?: boolean }): Promise<ManagedUser> {
    const result = await tx.user.updateMany({ where: { id: userId, version }, data: { ...data, version: { increment: 1 } } });
    if (result.count === 0) throw new HttpError('Concurrent update detected. Reload the user and try again.', 409);
    return tx.user.findUniqueOrThrow({ where: { id: userId }, select });
  },
  revokeRefreshTokens: (tx: Prisma.TransactionClient, userId: string) => tx.refreshToken.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } }),
};
