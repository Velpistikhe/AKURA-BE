import { prisma } from '../../config/db.js';
import { logger } from '../../utils/logger.js';
import { currentBusinessDate } from '../../utils/businessDate.js';

const systemActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System Scheduler' };

export const expireContracts = async (): Promise<number> => {
  const expired = await prisma.companyContract.findMany({ where: {
    isActive: true, status: { in: ['CREATE', 'ACTIVE'] }, effectiveUntil: { lte: currentBusinessDate() },
  } });
  let count = 0;
  for (const contract of expired) {
    try {
      await prisma.$transaction(async tx => {
        const updated = await tx.companyContract.update({ where: { id: contract.id, version: contract.version }, data: {
          status: 'EXPIRED', isActive: false, updatedById: systemActor.id, version: { increment: 1 },
        } });
        await tx.companyContractHistory.create({ data: {
          companyContractId: updated.id, version: updated.version, action: 'EXPIRE',
          snapshot: JSON.parse(JSON.stringify(updated)), createdById: systemActor.id, createdByName: systemActor.name,
        } });
      });
      count += 1;
    } catch (error: any) {
      if (error?.code !== 'P2025') throw error;
    }
  }
  return count;
};

export const startContractExpiryScheduler = (): void => {
  const scheduleNextRun = () => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const delay = nextMidnight.getTime() - now.getTime();
    setTimeout(() => {
      void expireContracts()
        .then(count => { if (count) logger.info(`Expired ${count} company contract(s)`); })
        .catch(error => logger.error('Company contract expiry scheduler failed', { error }))
        .finally(scheduleNextRun);
    }, delay).unref();
  };
  scheduleNextRun();
};
