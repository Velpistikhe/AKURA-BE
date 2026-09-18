import { NextFunction, Request, Response } from 'express';
import { serviceUrl, serviceHeaders } from '../utils/serviceUrl.js';
import { AuthenticatedRequest, AuthUser } from '../types/auth.types.js';
import { getAccessToken } from '../utils/requestTokens.js';

const requireSectionAccess = (sections: readonly string[]) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = getAccessToken(req);
  const tokenPayload = (req as AuthenticatedRequest).user;
  const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : undefined;
  if (!token || !tokenPayload) {
    res.status(401).json({ status: 401, success: false, message: 'Unauthorized: missing access token', requestId });
    return;
  }

  const gatewayUserId = req.headers['x-user-id'];
  const gatewayUserRole = req.headers['x-user-role'];
  const gatewayOfficeBranchId = req.headers['x-office-branch-id'];
  if (
    gatewayUserId !== tokenPayload.sub
    || (tokenPayload.role && gatewayUserRole !== tokenPayload.role)
    || (tokenPayload.officeBranchId && gatewayOfficeBranchId !== tokenPayload.officeBranchId)
  ) {
    res.status(401).json({
      status: 401,
      success: false,
      message: 'Unauthorized: gateway identity does not match access token',
      requestId,
    });
    return;
  }

  try {
    const response = await fetch(serviceUrl('auth/me'), {
      headers: {
        Authorization: `Bearer ${token}`,
        ...serviceHeaders('auth/me'),
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
    });
    if (!response.ok) {
      res.status(response.status === 403 ? 403 : 401).json({ status: response.status === 403 ? 403 : 401, success: false, message: 'Unable to validate the authenticated user', requestId });
      return;
    }
    const body = await response.json() as { data?: AuthUser };
    const user = body.data;
    if (!user || user.id !== tokenPayload.sub) {
      res.status(401).json({ status: 401, success: false, message: 'Unauthorized: user identity mismatch', requestId });
      return;
    }
    if (!user?.isActive) {
      res.status(403).json({ status: 403, success: false, message: 'Account is inactive', requestId });
      return;
    }
    if (!['ADMIN', 'APP_MANAGER'].includes(user.role) && !sections.includes(user.section ?? '')) {
      res.status(403).json({ status: 403, success: false, message: 'Access to this section is required', requestId });
      return;
    }
    if (!user.officeBranchId) {
      res.status(403).json({ status: 403, success: false, message: 'Office branch assignment is required', requestId });
      return;
    }
    if (tokenPayload.officeBranchId !== user.officeBranchId) {
      res.status(401).json({ status: 401, success: false, message: 'Unauthorized: office branch assignment has changed; please sign in again', requestId });
      return;
    }
    res.locals.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireMarketingAccess = requireSectionAccess(['MARKETING']);
// Read-only quotation references for downstream document creation. Branch checks remain mandatory.
export const requireQuotationReferenceAccess = requireSectionAccess(['MARKETING', 'FINANCE', 'ACCOUNTING', 'FIELD_SERVICE']);
