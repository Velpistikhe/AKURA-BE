import { NextFunction, Request, RequestHandler, Response } from 'express';

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
export const asyncHandler = (handler: Handler): RequestHandler => (req, res, next): void => {
  void handler(req, res, next).catch(next);
};
