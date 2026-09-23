import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { getErrorMessage, getErrorStack, getErrorStatus } from '../utils/errorDetails.js';

export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const requestId = req.headers['x-request-id'] as string;
  const status = getErrorStatus(err);
  const message = getErrorMessage(err);
  const stack = getErrorStack(err);

  const clientMessage = status >= 500 ? 'Internal server error' : message;

  logger.error(`Error processing request ${req.method} ${req.url}: ${message}`, {
    requestId,
    error: stack || err,
  });

  res.status(status).json({
    status,
    success: false,
    message: clientMessage,
    requestId,
    ...(env.NODE_ENV === 'development' && stack && { stack }),
  });
};
