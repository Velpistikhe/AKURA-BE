import { Prisma, QuotationItem } from '@prisma/client';

export const serviceScopeInclude = {
  scopes: { where: { revoked: false }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ServiceInclude;

export function serviceScopeSnapshot(service: Prisma.ServiceGetPayload<{ include: typeof serviceScopeInclude }>) {
  const inspection = service.scopes.filter(row => row.type === 'INSPECTION').map(row => row.scope);
  const maintenance = service.hasMaintenance ? service.scopes.filter(row => row.type === 'MAINTENANCE').map(row => row.scope) : [];
  const joined = (scopes: string[]) => [...new Set(scopes.map(scope => scope.trim()).filter(Boolean))].join(', ');
  return { serviceId: service.id, serviceScopes: joined([...inspection, ...maintenance]),
    inspectionScopes: joined(inspection), maintenanceScopes: joined(maintenance) };
}

export function groupQuotationItems(items: QuotationItem[]) {
  const groups = new Map<string, { type: string; name: string; scopes: string; inspectionScopes: string; maintenanceScopes: string; items: QuotationItem[] }>();
  for (const item of [...items].filter(item => item.isActive).sort((a, b) => a.position - b.position)) {
    const snapshot = item.priceSelection as Record<string, unknown> | null;
    const key = typeof snapshot?.serviceId === 'string' ? snapshot.serviceId : JSON.stringify([item.serviceType, item.serviceName]);
    let group = groups.get(key);
    if (!group) {
      group = { type: item.serviceType, name: item.serviceName, scopes: typeof snapshot?.serviceScopes === 'string' ? snapshot.serviceScopes : '',
        inspectionScopes: typeof snapshot?.inspectionScopes === 'string' ? snapshot.inspectionScopes : '',
        maintenanceScopes: typeof snapshot?.maintenanceScopes === 'string' ? snapshot.maintenanceScopes : '', items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
