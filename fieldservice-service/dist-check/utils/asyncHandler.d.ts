import { NextFunction, Request, RequestHandler, Response } from 'express';
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const asyncHandler: (handler: AsyncHandler) => RequestHandler;
export {};
