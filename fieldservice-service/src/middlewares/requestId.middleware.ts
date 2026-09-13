import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = typeof req.headers['x-request-id'] === 'string'
    ? req.headers['x-request-id']
    : randomUUID();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
};
