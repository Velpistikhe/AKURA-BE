import { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const asyncHandler = (handler: AsyncHandler): RequestHandler => (
  req,
  res,
  next
): void => {
  void handler(req, res, next).catch(next);
};
