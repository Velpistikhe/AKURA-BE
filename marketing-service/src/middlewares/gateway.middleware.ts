import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { isDirectMfeAccess } from '../utils/directAccess.js';

export const verifyGatewaySecret = (req: Request, res: Response, next: NextFunction): void => {
  const gatewaySecret = req.headers['x-gateway-secret'];
  const isMarketingMfeRoute = req.path === '/marketing' || req.path.startsWith('/marketing/');

  // Direct development access applies only to user-facing Marketing routes.
  // Internal tax/user-sync endpoints remain gateway-only even in development.
  if (gatewaySecret === undefined && isMarketingMfeRoute && isDirectMfeAccess()) {
    next();
    return;
  }

  if (gatewaySecret !== env.GATEWAY_SECRET) {
    res.status(403).json({ status: 403, success: false, message: 'Access denied: requests must pass through the API Gateway', requestId: req.headers['x-request-id'] });
    return;
  }
  next();
};
