import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/errorDetails.js';
import { getAccessToken } from '../utils/requestTokens.js';
import { verifyAccessToken } from '../utils/tokens.js';

export const authenticateJwt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

  try {
    const decoded = await verifyAccessToken(token);
    req.headers['x-user-id'] = decoded.sub;
    if (decoded.role) req.headers['x-user-role'] = decoded.role;
    if (decoded.username) req.headers['x-user-username'] = decoded.username;
    next();
  } catch (error: unknown) {
    logger.warn(`JWT verification failed: ${getErrorMessage(error)}`, { requestId });
    res.status(401).json({
      status: 401,
      success: false,
      message: 'Unauthorized: Invalid or expired access token',
      requestId,
    });
  }
};
