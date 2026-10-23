import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';

// All menu hierarchy writes share this lock. Parent deletion and child
// creation/moves must serialize to avoid attaching data to a deleted parent.
export const menuWrite = <T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
  prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('app-manager:menu-write'))`;
    return action(tx);
  }, { maxWait: 10000, timeout: 20000 });
