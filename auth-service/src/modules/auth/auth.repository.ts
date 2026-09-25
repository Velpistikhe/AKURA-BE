import { Prisma, PrismaClient, RefreshToken, User, UserPassword } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';

type TxClient = Prisma.TransactionClient | PrismaClient;

class AuthRepository {
  async createUser(
    client: TxClient,
    username: string,
    passwordHash: string,
    firstName: string,
    lastName: string,
    email?: string | null,
    telp?: string | null
  ): Promise<User> {
    try {
      const user = await client.user.create({
        data: {
          username: username.trim(),
          normalizeUsername: username.toLowerCase().trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email ?? null,
          telp: telp ?? null,
        },
      });
      await client.userPassword.create({ data: { userId: user.id, passwordHash } });
      return user;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target)
          ? error.meta.target.map(String)
          : [String(error.meta?.target ?? '')];
        const usernameConflict = target.some((field) =>
          ['username', 'normalizeUsername', 'normalize_username'].some((name) => field.includes(name))
        );
        throw new HttpError(usernameConflict ? 'Username already registered' : 'Unique value already registered', 409);
      }
      throw error;
    }
  }

  findUserByUsername(username: string): Promise<(User & { password: UserPassword | null }) | null> {
    return prisma.user.findUnique({
      where: { normalizeUsername: username.toLowerCase().trim() },
      include: { password: true },
    });
  }

  findUserById(client: TxClient, id: string): Promise<User | null> {
    return client.user.findUnique({ where: { id } });
  }

  async findUserByIdForUpdate(client: TxClient, id: string): Promise<User | null> {
    const rows = await client.$queryRaw<User[]>`
      SELECT
        id,
        username,
        normalize_username as "normalizeUsername",
        first_name as "firstName",
        last_name as "lastName",
        email,
        telp,
        role,
        section,
        office_branch_id as "officeBranchId",
        is_active as "isActive",
        version,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM "users"
      WHERE id = ${id}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async findPasswordByUserIdForUpdate(client: TxClient, userId: string): Promise<UserPassword | null> {
    const rows = await client.$queryRaw<UserPassword[]>`
      SELECT
        id,
        user_id as "userId",
        password_hash as "passwordHash",
        version,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM "user_passwords"
      WHERE user_id = ${userId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async updateProfileAtomic(
    client: TxClient,
    userId: string,
    firstName: string,
    lastName: string,
    expectedVersion: number,
    email?: string | null,
    telp?: string | null
  ): Promise<User> {
    const updated = await client.user.updateMany({
      where: { id: userId, version: expectedVersion },
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(email !== undefined && { email }),
        ...(telp !== undefined && { telp }),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new HttpError('Concurrent update detected. Please try again.', 409);
    }
    return client.user.findUniqueOrThrow({ where: { id: userId } });
  }

  async updatePasswordAtomic(
    client: TxClient,
    userId: string,
    passwordHash: string,
    expectedVersion: number
  ): Promise<UserPassword> {
    const updated = await client.userPassword.updateMany({
      where: { userId, version: expectedVersion },
      data: {
        passwordHash,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw new HttpError('Concurrent update detected. Please try again.', 409);
    }
    return client.userPassword.findUniqueOrThrow({ where: { userId } });
  }

  saveRefreshToken(
    client: TxClient,
    userId: string,
    token: string,
    expiresAt: Date,
    familyId: string,
    lastActivityAt = new Date()
  ): Promise<RefreshToken> {
    return client.refreshToken.create({
      data: { userId, token, expiresAt, familyId, lastActivityAt },
    });
  }

  async findRefreshTokenForUpdate(client: TxClient, token: string): Promise<RefreshToken | null> {
    const rows = await client.$queryRaw<RefreshToken[]>`
      SELECT
        id,
        user_id as "userId",
        family_id as "familyId",
        token,
        expires_at as "expiresAt",
        is_revoked as "isRevoked",
        last_activity_at as "lastActivityAt",
        created_at as "createdAt"
      FROM "refresh_tokens"
      WHERE token = ${token}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async revokeRefreshToken(client: TxClient, token: string, lastActivityAt?: Date): Promise<boolean> {
    const updated = await client.refreshToken.updateMany({
      where: { token },
      data: { isRevoked: true, ...(lastActivityAt && { lastActivityAt }) },
    });
    return updated.count > 0;
  }

  async revokeTokenFamily(client: TxClient, familyId: string): Promise<number> {
    const updated = await client.refreshToken.updateMany({
      where: { familyId, isRevoked: false },
      data: { isRevoked: true },
    });
    return updated.count;
  }

  async revokeAllUserRefreshTokens(client: TxClient, userId: string): Promise<number> {
    const updated = await client.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
    return updated.count;
  }
}

export const authRepository = new AuthRepository();
