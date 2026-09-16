import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { getErrorMessage, getErrorStack, getErrorStatus } from '../utils/errorDetails.js';
import { logger } from '../utils/logger.js';

export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
  const conflict = error instanceof Prisma.PrismaClientKnownRequestError && ['P2002','P2034'].includes(error.code);
  const status = error instanceof ZodError ? 400 : conflict ? 409 : getErrorStatus(error);
  const message = error instanceof ZodError ? 'Invalid request data' : conflict ? 'Work order number already exists or concurrent update conflict; reload before retrying' : status >= 500 ? 'Internal server error' : getErrorMessage(error);
  const stack = getErrorStack(error);
  const metadata = { requestId: req.headers['x-request-id'], error: stack || error };
  if (status >= 500) logger.error(message, metadata);
  else logger.warn(message, metadata);
  res.status(status).json({
    status,
    success: false,
    message,
    ...(error instanceof ZodError ? { errors: error.flatten() } : {}),
    requestId: req.headers['x-request-id'],
    ...(env.NODE_ENV === 'development' && stack && { stack }),
  });
};
