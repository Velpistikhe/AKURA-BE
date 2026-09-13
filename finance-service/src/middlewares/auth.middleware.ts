import { NextFunction, Request, Response } from 'express';
import { AuthenticatedRequest } from '../types/auth.types.js';
import { getAccessToken } from '../utils/requestTokens.js';
import { verifyAccessToken } from '../utils/tokens.js';

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = getAccessToken(req);
  if (!token) {
    res.status(401).json({
      status: 401,
      success: false,
      message: 'Unauthorized: missing access token',
      requestId: req.headers['x-request-id'],
    });
    return;
  }

  try {
    (req as AuthenticatedRequest).user = await verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({
      status: 401,
      success: false,
      message: 'Unauthorized: invalid or expired access token',
      requestId: req.headers['x-request-id'],
    });
  }
};
