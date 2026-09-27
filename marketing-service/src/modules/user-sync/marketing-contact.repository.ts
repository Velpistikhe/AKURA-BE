import { prisma } from '../../config/db.js';
import { MarketingContact } from '../../types/auth.types.js';

export async function loadMarketingContacts(officeBranchId: string): Promise<MarketingContact[]> {
  const users = await prisma.marketingAdminUser.findMany({
    where: { officeBranchId },
    select: { firstName: true, lastName: true, email: true, telp: true },
    orderBy: [{ sourceCreatedAt: 'asc' }, { id: 'asc' }],
    take: 20,
  });
  return users.map(user => ({ name: `${user.firstName} ${user.lastName}`.trim(), email: user.email, telp: user.telp }));
}
