import { Prisma } from '@prisma/client';
import { AuditActor } from '../types/auth.types.js';
import { HttpError } from './httpError.js';

export type CatalogEntity = 'SERVICE' | 'SERVICE_SCOPE' | 'MAINTENANCE_SCOPE' | 'ITEM' | 'ITEM_SIZE' | 'ITEM_PRICE' | 'COMPANY_CONTRACT_PRICE' | 'COMPANY_CONTRACT';
export const requireCatalogVersion = (row: { version: number; isActive: boolean }, version: number, allowInactive = false) => {
  if ((!allowInactive && !row.isActive) || row.version !== version) {
    throw new HttpError('Data has changed or is inactive; reload and submit the current version', 409);
  }
};

export const recordCatalogAudit = (
  tx: Prisma.TransactionClient, officeBranchId: string, entityType: CatalogEntity,
  before: unknown, after: { id: string; version: number }, actor: AuditActor, action: string,
) => tx.catalogAuditLog.create({ data: {
  officeBranchId, entityType, entityId: after.id, version: after.version, action,
  before: before == null ? Prisma.DbNull : JSON.parse(JSON.stringify(before)),
  after: JSON.parse(JSON.stringify(after)), createdById: actor.id, createdByName: actor.name,
} });
