import { Prisma } from '@prisma/client';
export declare const workOrderDate: (now?: Date) => Date;
export declare function nextWorkOrderIdentity(tx: Prisma.TransactionClient, officeBranchId: string, clock?: () => Date): Promise<{
    number: string;
    date: Date;
}>;
