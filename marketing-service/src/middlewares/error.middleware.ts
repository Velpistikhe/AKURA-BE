import { Prisma } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const errorHandler = (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
  let status = typeof (error as { statusCode?: unknown })?.statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
  let message = error instanceof Error ? error.message : 'Internal Server Error';
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    status = 409;
    message = 'A record with the same unique value already exists';
  }
  const clientMessage = status >= 500 ? 'Internal server error' : message;
  logger.log(status >= 500 ? 'error' : 'warn', message, { requestId: req.headers['x-request-id'], error: status >= 500 ? error : undefined });
  res.status(status).json({ status, success: false, message: clientMessage, requestId: req.headers['x-request-id'], ...(env.NODE_ENV === 'development' && error instanceof Error && { stack: error.stack }) });
};
