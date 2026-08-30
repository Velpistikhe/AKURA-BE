import { Request } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware.js';
import { HttpError } from './httpError.js';

export const getAuthenticatedUserId = (req: Request): string => {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) {
    throw new HttpError('Unauthorized', 401);
  }
  return userId;
};
