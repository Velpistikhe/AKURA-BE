import { NextFunction, Response } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/db.js';
import { AuthenticatedRequest } from './auth.middleware.js';

export const requireAppManager = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const actorId = req.user?.id;
  if (!actorId) {
    res.status(401).json({ status: 401, success: false, message: 'Unauthorized', requestId: req.headers['x-request-id'] });
    return;
  }
  try {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
    if (!actor?.isActive || actor.role !== UserRole.APP_MANAGER) {
      res.status(403).json({ status: 403, success: false, message: 'Active app manager role is required', requestId: req.headers['x-request-id'] });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
