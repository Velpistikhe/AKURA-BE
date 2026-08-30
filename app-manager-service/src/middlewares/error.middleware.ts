import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { getErrorMessage, getErrorStack, getErrorStatus } from '../utils/errorDetails.js';
import { logger } from '../utils/logger.js';

export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);
  const stack = getErrorStack(error);
  const metadata = { requestId: req.headers['x-request-id'], error: stack || error };
  if (status >= 500) logger.error(message, metadata);
  else logger.warn(message, metadata);
  res.status(status).json({
    status,
    success: false,
    message,
    requestId: req.headers['x-request-id'],
    ...(env.NODE_ENV === 'development' && stack && { stack }),
  });
};
