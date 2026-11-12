import { Request, Response, NextFunction } from 'express';
export interface Actor {
    id: string;
    name: string;
    officeBranchId: string;
}
export declare const requireActor: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const requireWorkOrderReferenceActor: (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare const requireWorkOrderSection: (...sections: string[]) => (_req: Request, res: Response, next: NextFunction) => void;
/** POST work-order creation: MARKETING section with ADMIN or USER role only. */
export declare const requireMarketingAdminOrUser: (_req: Request, res: Response, next: NextFunction) => void;
