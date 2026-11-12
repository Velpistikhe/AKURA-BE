import { PrismaClient } from '@prisma/client';
export declare const prisma: PrismaClient<{
    log: ("error" | "warn")[];
}, never, import("@prisma/client/runtime/library").DefaultArgs>;
export declare const connectDb: () => Promise<void>;
export declare const disconnectDb: () => Promise<void>;
