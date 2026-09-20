import { prisma } from '../../config/db.js';
import { logger } from '../../utils/logger.js';
import { recordContractHistory } from './contract-history.js';

import { currentBusinessDate } from '../../utils/businessDate.js';

const systemActor = { id: '00000000-0000-0000-0000-000000000000', name: 'System Scheduler' };

export const expireContracts = async (): Promise<number> => {
  const expired = await prisma.companyContract.findMany({ where: { status: { in: ['DRAFT', 'APPROVED'] }, effectiveUntil: { lte: currentBusinessDate() },
  } });
  let count = 0;
  for (const contract of expired) {
    try {
      await prisma.$transaction(async tx => {
        const updated = await tx.companyContract.update({ where: { id: contract.id, version: contract.version }, data: {
          status: 'CANCELED', updatedById: systemActor.id, version: { increment: 1 },
        } });
        await recordContractHistory(tx, contract, updated, systemActor, 'EXPIRE');
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
