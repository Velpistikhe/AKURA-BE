import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export const loggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] as string;

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const { method, originalUrl } = req;
    const { statusCode } = res;
    
    logger.info(`${method} ${originalUrl} ${statusCode} - ${duration}ms`, {
      requestId,
      method,
      url: originalUrl,
      status: statusCode,
      durationMs: duration,
      ip: req.ip,
    });
  });

  next();
};
