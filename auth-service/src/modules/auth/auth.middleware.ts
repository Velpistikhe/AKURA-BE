import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/db.js';
import { getAccessToken } from '../../utils/requestTokens.js';
import { verifyAccessToken } from '../../utils/tokens.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name?: string;
    username?: string;
    role?: string;
    // The office branch the access token was issued for. It is part of the
    // signed token, so it is the branch the caller was authenticated against,
    // and it is what scopes a read to the caller's own branch.
    officeBranchId?: string | null;
  };
}

export const authenticate = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const requestId = req.headers['x-request-id'] as string;
  const token = getAccessToken(req);

  if (!token) {
    res.status(401).json({
      status: 401,
      success: false,
      message: 'Unauthorized: Missing or invalid Authorization header/cookie',
      requestId,
    });
    return;
  }

  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    res.status(401).json({
      status: 401,
      success: false,
      message: 'Unauthorized: Access token is invalid or expired',
      requestId,
    });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { isActive: true },
    });
    if (!user?.isActive) {
      res.status(403).json({
        status: 403,
        success: false,
        message: 'Account is inactive',
        requestId,
      });
      return;
    }
    req.user = {
      id: decoded.sub,
      name: decoded.name,
      username: decoded.username,
      role: decoded.role,
      officeBranchId: decoded.officeBranchId,
    };
    next();
  } catch (error) {
    next(error);
  }
};
