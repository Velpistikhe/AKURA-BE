import { Prisma } from '@prisma/client';
import { AuditActor } from '../types/auth.types.js';
import { HttpError } from './httpError.js';
import { recordAudit } from './audit.js';

export type CatalogEntity = 'SERVICE' | 'SERVICE_SCOPE' | 'MAINTENANCE_SCOPE' | 'ITEM' | 'ITEM_SIZE' | 'ITEM_PRICE' | 'COMPANY_CONTRACT_PRICE' | 'COMPANY_CONTRACT';
export const requireCatalogVersion = (row: { version: number; isActive?: boolean }, version: number, allowInactive = false) => {
  if ((!allowInactive && row.isActive === false) || row.version !== version) {
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

/**
 * The module that owns a catalogue entity.
 *
 * The generic audit trail names the module, so the catalogue entries can be
 * queried next to the entries of the other modules.
 */
const catalogModule = (entityType: CatalogEntity): 'services' | 'items' | 'contracts' | 'contract-prices' => {
  if (entityType === 'SERVICE' || entityType === 'SERVICE_SCOPE' || entityType === 'MAINTENANCE_SCOPE') return 'services';
  if (entityType === 'ITEM' || entityType === 'ITEM_SIZE' || entityType === 'ITEM_PRICE') return 'items';
  if (entityType === 'COMPANY_CONTRACT') return 'contracts';
  return 'contract-prices';
};

/**
 * Records a catalogue change in both audit tables.
 *
 * The catalogue table is the module's own trail, and the generic table is the
 * platform-wide trail that every module writes to. Both are written in the
 * same transaction, so they can never disagree.
 */
export const recordCatalogAuditWithPlatform = async (
  tx: Prisma.TransactionClient, officeBranchId: string, entityType: CatalogEntity,
  before: unknown, after: { id: string; version: number }, actor: AuditActor, action: string,
): Promise<void> => {
  await recordCatalogAudit(tx, officeBranchId, entityType, before, after, actor, action);
  await recordAudit(tx, {
    module: catalogModule(entityType),
    entityType: entityType as 'COMPANY' | 'COMPANY_STAFF' | 'QUOTATION' | 'TAX',
    entityId: after.id,
    version: after.version,
    action,
    before,
    after,
    officeBranchId,
    actor,
  });
};