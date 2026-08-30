import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export const verifyGatewaySecret = (req: Request, res: Response, next: NextFunction): void => {
  const gatewaySecret = req.headers['x-gateway-secret'];

  if (!gatewaySecret || gatewaySecret !== env.GATEWAY_SECRET) {
    res.status(403).json({
      status: 403,
      success: false,
      message: 'Access Denied: Microservices can only be accessed through the API Gateway',
      requestId: req.headers['x-request-id'],
    });
    return;
  }

  next();
};
