import { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

type RequestSource = 'body' | 'query' | 'params';

export const validate = (source: RequestSource, schema: z.ZodTypeAny): RequestHandler => (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    res.status(400).json({
      status: 400,
      success: false,
      message: result.error.errors[0]?.message ?? 'Validation failed',
      errors: result.error.errors,
      requestId: req.headers['x-request-id'],
    });
    return;
  }
  res.locals[source] = result.data;
  next();
};

export const validateBody = (schema: z.ZodTypeAny): RequestHandler => (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const firstError = result.error.errors[0];
    res.status(400).json({
      status: 400,
      success: false,
      message: firstError?.message ?? 'Validation failed',
      errors: result.error.errors,
      requestId: req.headers['x-request-id'],
    });
    return;
  }

  req.body = result.data;
  next();
};
