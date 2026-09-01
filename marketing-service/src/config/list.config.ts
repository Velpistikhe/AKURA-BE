import { StaffTitle } from '@prisma/client';
import { z } from 'zod';

const pagination = {
  defaultPage: 1,
  defaultLimit: 20,
  maxLimit: 100,
} as const;

const booleanFilter = z.enum(['true', 'false']).transform((value) => value === 'true').optional();

export const COMPANY_LIST_CONFIG = {
  sortFields: ['name', 'type', 'address', 'hasContract', 'version', 'updatedAt'],
  filterFields: {
    search: z.string().trim().min(1).max(100).optional(),
    hasContract: booleanFilter,
  },
  pagination,
} as const;

export const SERVICE_LIST_CONFIG = {
  sortFields: ['code', 'name', 'isActive'],
  filterFields: {
    code: z.string().trim().min(1).max(50).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    isActive: booleanFilter,
  },
  pagination,
} as const;

export const ITEM_LIST_CONFIG = {
  sortFields: ['serviceName', 'itemName', 'size'],
  filterFields: {
    serviceName: z.string().trim().min(1).max(200).optional(),
    itemName: z.string().trim().min(1).max(200).optional(),
    size: z.string().trim().min(1).max(100).optional(),
  },
  pagination,
} as const;

export const COMPANY_STAFF_LIST_CONFIG = {
  sortFields: ['companyId', 'name', 'title', 'version', 'updatedAt'],
  filterFields: {
    companyId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(100).optional(),
    title: z.nativeEnum(StaffTitle).optional(),
  },
  pagination,
} as const;
