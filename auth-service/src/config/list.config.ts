import { UserRole, UserSection } from '@prisma/client';
import { z } from 'zod';

export const USER_LIST_CONFIG = {
  sortFields: ['username', 'firstName', 'lastName', 'role', 'section', 'officeBranchId', 'isActive', 'updatedAt'],
  filterFields: {
    search: z.string().trim().min(1).max(100).optional(),
    role: z.nativeEnum(UserRole).optional(),
    section: z.nativeEnum(UserSection).optional(),
    officeBranchId: z.string().uuid('Invalid office branch ID').optional(),
    isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  },
  pagination: {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 100,
  },
} as const;
