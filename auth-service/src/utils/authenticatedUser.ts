import { Request } from 'express';
import { AuthenticatedRequest } from '../modules/auth/auth.middleware.js';
import { HttpError } from './httpError.js';

export const getAuthenticatedUserId = (req: Request): string => {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    throw new HttpError('Unauthorized', 401);
  }
  return userId;
};

export const getAuthenticatedActor = (req: Request): { id: string; name: string } => {
  const user = (req as AuthenticatedRequest).user;
  if (!user?.id) {
    throw new HttpError('Unauthorized', 401);
  }
  return { id: user.id, name: user.name?.trim() || user.username?.trim() || 'Unknown user' };
};

/**
 * The identity of the caller, together with the office branch and the role the
 * access token was issued for.
 *
 * The branch comes from the verified token, so it is the branch the caller was
 * authenticated against. It scopes a read to the caller's own branch.
 */
export const getAuthenticatedActorContext = (req: Request): {
  id: string;
  name: string;
  role: string;
  officeBranchId: string | null;
} => {
  const user = (req as AuthenticatedRequest).user;
  if (!user?.id) {
    throw new HttpError('Unauthorized', 401);
  }
  return {
    id: user.id,
    name: user.name?.trim() || user.username?.trim() || 'Unknown user',
    role: user.role ?? '',
    officeBranchId: user.officeBranchId ?? null,
  };
};
