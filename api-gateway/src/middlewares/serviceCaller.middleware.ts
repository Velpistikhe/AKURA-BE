import { timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';

const serviceSecrets = {
  'auth-service': env.AUTH_SERVICE_GATEWAY_SECRET,
  'app-manager-service': env.APP_MANAGER_SERVICE_GATEWAY_SECRET,
  'marketing-service': env.MARKETING_SERVICE_GATEWAY_SECRET,
} as const;

type ServiceName = keyof typeof serviceSecrets;

const secretsMatch = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
};

declare global {
  namespace Express {
    interface Locals {
      serviceCaller?: ServiceName;
    }
  }
}

export const authenticateServiceCaller = (req: Request, res: Response, next: NextFunction): void => {
  const serviceName = req.headers['x-service-name'];
  const serviceSecret = req.headers['x-service-secret'];

  if (serviceName === undefined && serviceSecret === undefined) {
    next();
    return;
  }

  const expectedSecret = typeof serviceName === 'string'
    ? serviceSecrets[serviceName as ServiceName]
    : undefined;
  if (typeof serviceSecret !== 'string' || !expectedSecret || !secretsMatch(serviceSecret, expectedSecret)) {
    res.status(403).json({
      status: 403,
      success: false,
      message: 'Invalid internal service credentials',
      requestId: req.headers['x-request-id'],
    });
    return;
  }

  res.locals.serviceCaller = serviceName as ServiceName;
  next();
};
