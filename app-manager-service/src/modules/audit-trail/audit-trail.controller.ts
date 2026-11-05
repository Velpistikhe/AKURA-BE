import { Request, Response } from 'express';
import { ListAuditTrailInput } from './audit-trail.schemas.js';
import { auditTrailRepository } from './audit-trail.repository.js';

type AuditTrailParams = { entityId: string };

export const auditTrailController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await auditTrailRepository.list(res.locals.query as ListAuditTrailInput);
    res.status(200).json({
      status: 200,
      success: true,
      message: 'Audit trail retrieved successfully',
      data: result,
      requestId: req.headers['x-request-id'],
    });
  },

  async listForEntity(req: Request, res: Response): Promise<void> {
    const entries = await auditTrailRepository.listForEntity((res.locals.params as AuditTrailParams).entityId);
    res.status(200).json({
      status: 200,
      success: true,
      message: 'Audit trail retrieved successfully',
      data: entries,
      requestId: req.headers['x-request-id'],
    });
  },
};
