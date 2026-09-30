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
