import { UserRole, UserSection } from '@prisma/client';

export interface UserSanitized {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  section: UserSection | null;
  officeBranchId: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface AuthResult {
  user: UserSanitized;
  tokens: AuthTokens;
}

export type RefreshTransactionResult =
  | { success: true; tokens: AuthTokens }
  | { success: false; statusCode: number; message: string };
