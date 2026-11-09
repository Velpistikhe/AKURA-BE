import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

export const verifyGatewaySecret = (req: Request, res: Response, next: NextFunction): void => {
  // Every request must arrive through the API Gateway. The gateway injects the
  // per-service secret on every proxied request, so a request that reaches the
  // service directly - from a browser or from any other client - is refused.
  if (req.headers['x-gateway-secret'] !== env.GATEWAY_SECRET) {
    res.status(403).json({ status: 403, success: false, message: 'Access denied: requests must pass through the API Gateway', requestId: req.headers['x-request-id'] });
    return;
  }
  next();
};
