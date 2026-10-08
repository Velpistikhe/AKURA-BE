import { prisma } from '../../config/db.js';
import { MarketingContact } from '../../types/auth.types.js';

/** Shape of the JSON snapshot stored on each read-model row. */
interface MarketingAdminUserSnapshot {
  firstName: string;
  lastName: string;
  email: string | null;
  telp: string | null;
}

export async function loadMarketingContacts(officeBranchId: string): Promise<MarketingContact[]> {
  const users = await prisma.marketingAdminUser.findMany({
    where: { officeBranchId },
    select: { user: true },
    orderBy: [{ sourceCreatedAt: 'asc' }, { id: 'asc' }],
    take: 20,
  });
  return users.flatMap(({ user }): MarketingContact[] => {
    const snapshot = user as unknown as MarketingAdminUserSnapshot;
    if (typeof snapshot.firstName !== 'string' || typeof snapshot.lastName !== 'string') return [];
    return [{
      name: `${snapshot.firstName} ${snapshot.lastName}`.trim(),
      email: typeof snapshot.email === 'string' ? snapshot.email : null,
      telp: typeof snapshot.telp === 'string' ? snapshot.telp : null,
    }];
  });
}
