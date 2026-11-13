import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { gatewayGet } from '../integrations/gateway.js';
import { AuthenticatedRequest } from '../types/auth.types.js';
import { HttpError } from '../utils/httpError.js';
const profileSchema = z.object({ id: z.string().uuid(), officeBranchId: z.string().uuid().nullable(), isActive: z.boolean(), role: z.string(), section: z.string().nullable(), firstName: z.string(), lastName: z.string(), username: z.string() });
export interface Actor { id: string; name: string; officeBranchId: string }
const resolveActor = (sections: readonly string[]) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = profileSchema.safeParse(await gatewayGet('auth/me', req));
    if (!result.success) throw new HttpError('Invalid user profile response', 502);
    const profile = result.data;
    if (profile.id !== (req as AuthenticatedRequest).user?.sub) throw new HttpError('User identity mismatch', 401);
    if (!profile.isActive || !profile.officeBranchId) throw new HttpError('Active user and office branch assignment are required', 403);
    if ((req as AuthenticatedRequest).user?.officeBranchId !== profile.officeBranchId) throw new HttpError('Office branch assignment has changed; please sign in again', 401);
    if (!['ADMIN', 'APP_MANAGER'].includes(profile.role) && !sections.includes(profile.section ?? '')) throw new HttpError('Access to this section is required', 403);
    res.locals.workOrderSection = profile.section;
    res.locals.workOrderRole = profile.role;
    res.locals.workOrderActor = { id: profile.id, name: `${profile.firstName} ${profile.lastName}`.trim() || profile.username, officeBranchId: profile.officeBranchId } satisfies Actor;
    next();
  } catch (error) { next(error); }
}
export const requireActor = resolveActor(['MARKETING', 'FIELD_SERVICE']);
export const requireWorkOrderSection = (...sections: string[]) => (_req: Request, res: Response, next: NextFunction) => {
  if (!sections.includes(res.locals.workOrderSection)) return next(new HttpError('Access to this section is required', 403));
  next();
};
/**
 * Work Order creation and update: MARKETING section with the USER role only.
 * ADMIN and APP_MANAGER are rejected, so the marketing officer who owns the
 * document is the only actor allowed to write a Work Order.
 */
export const requireMarketingUser = (_req: Request, res: Response, next: NextFunction) => {
  if (res.locals.workOrderSection !== 'MARKETING') return next(new HttpError('Access to this section is required', 403));
  const role = res.locals.workOrderRole as string | undefined;
  if (role !== 'USER') return next(new HttpError('USER role is required', 403));
  next();
};
