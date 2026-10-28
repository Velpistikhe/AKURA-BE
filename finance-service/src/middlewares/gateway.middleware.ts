import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { isDirectMfeAccess } from '../utils/directAccess.js';

export const verifyGatewaySecret = (req: Request, res: Response, next: NextFunction): void => {
  const gatewaySecret = req.headers['x-gateway-secret'];
  const isFinanceRoute = req.path === '/finance'
    || req.path.startsWith('/finance/')
    || req.path === '/taxes'
    || req.path.startsWith('/taxes/')
    || req.path === '/documents'
    || req.path.startsWith('/documents/');

  // Direct development access applies only to user-facing Finance routes.
  // Internal tax delivery and health checks remain gateway-only.
  if (gatewaySecret === undefined && isFinanceRoute && isDirectMfeAccess()) {
    next();
    return;
  }

  if (gatewaySecret !== env.GATEWAY_SECRET) {
    res.status(403).json({
      status: 403,
      success: false,
      message: 'Access denied: requests must pass through the API Gateway',
      requestId: req.headers['x-request-id'],
    });
    return;
  }
  next();
};
