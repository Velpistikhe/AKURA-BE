import { Response } from 'express';
import { AuditActor } from '../types/auth.types.js';
import { HttpError } from './httpError.js';

export const getOfficeBranchId = (res: Response): string => {
  const officeBranchId = res.locals.authUser?.officeBranchId;
  if (!officeBranchId) throw new HttpError('Office branch assignment is required', 403);
  return officeBranchId;
};

export const getAuditActor = (res: Response): AuditActor => {
  const user = res.locals.authUser;
  if (!user) throw new HttpError('Authenticated user is required', 401);
  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`.trim() || user.username,
  };
};

export const restrictListVisibility = <T extends object>(res: Response, query: T): T & { isActive?: boolean } => {
  const user = res.locals.authUser;
  if (!user) throw new HttpError('Authenticated user is required', 401);
  return user.role === 'ADMIN' ? query : { ...query, isActive: true };
};
