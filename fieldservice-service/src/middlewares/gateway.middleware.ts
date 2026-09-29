import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { isDirectMfeAccess } from '../utils/directAccess.js';

export const verifyGatewaySecret = (req: Request, res: Response, next: NextFunction): void => {
  const gatewaySecret = req.headers['x-gateway-secret'];
  const isWorkOrderRoute = req.path === '/fieldservice'
    || req.path.startsWith('/fieldservice/')
    || req.path === '/work-orders'
    || req.path.startsWith('/work-orders/');

  if (gatewaySecret === undefined && isWorkOrderRoute && isDirectMfeAccess()) {
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
