import { NextFunction, Request, Response } from 'express';
declare global {
    namespace Express {
        interface Locals {
            arrivedViaGateway?: boolean;
        }
    }
}
export declare const verifyGatewaySecret: (req: Request, res: Response, next: NextFunction) => void;
