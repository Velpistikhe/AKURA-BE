import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/auth.types.js';
import { isDirectMfeAccess } from '../utils/directAccess.js';
import { getAccessToken } from '../utils/requestTokens.js';
import { verifyAccessToken } from '../utils/tokens.js';

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = getAccessToken(req);
  if (!token) {
    res.status(401).json({ status: 401, success: false, message: 'Unauthorized: missing access token', requestId: req.headers['x-request-id'] });
    return;
  }
  try {
    const user = await verifyAccessToken(token);
    (req as AuthenticatedRequest).user = user;

    // In direct development access there is no gateway to rebuild the identity
    // headers from the verified token. Fill only headers the client omitted so
    // a forged x-user-id/x-user-role still fails the authorize comparison.
    if (isDirectMfeAccess()) {
      if (req.headers['x-user-id'] === undefined) req.headers['x-user-id'] = user.sub;
      if (user.role && req.headers['x-user-role'] === undefined) req.headers['x-user-role'] = user.role;
      if (user.officeBranchId && req.headers['x-office-branch-id'] === undefined) req.headers['x-office-branch-id'] = user.officeBranchId;
    }
    next();
  } catch {
    res.status(401).json({ status: 401, success: false, message: 'Unauthorized: invalid or expired access token', requestId: req.headers['x-request-id'] });
  }
};
