import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { allowsLocalDirectAccess, isGatewayOnlyPath } from '../utils/localDirectAccess.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      arrivedViaGateway?: boolean;
    }
  }
}

export const verifyGatewaySecret = (req: Request, res: Response, next: NextFunction): void => {
  const secret = req.headers['x-gateway-secret'];
  if (typeof secret === 'string' && secret === env.GATEWAY_SECRET) {
    res.locals.arrivedViaGateway = true;
    next();
    return;
  }

  if (req.method === 'OPTIONS' && allowsLocalDirectAccess()) {
    res.locals.arrivedViaGateway = false;
    next();
    return;
  }

  if (allowsLocalDirectAccess() && !isGatewayOnlyPath(req)) {
    res.locals.arrivedViaGateway = false;
    next();
    return;
  }

  res.status(403).json({
    status: 403,
    success: false,
    message: 'Access denied: requests must pass through the API Gateway',
    requestId: req.headers['x-request-id'],
  });
};
