import { Response } from 'express';
import { HttpError } from './httpError.js';

export const getOfficeBranchId = (res: Response): string => {
  const officeBranchId = res.locals.authUser?.officeBranchId;
  if (!officeBranchId) throw new HttpError('Office branch assignment is required', 403);
  return officeBranchId;
};
