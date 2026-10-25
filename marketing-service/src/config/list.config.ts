import { ServiceType, StaffTitle } from '@prisma/client';
import { z } from 'zod';

const pagination = {
  defaultPage: 1,
  defaultLimit: 20,
  maxLimit: 100,
} as const;

const booleanFilter = z.enum(['true', 'false']).transform((value) => value === 'true').optional();

export const COMPANY_LIST_CONFIG = {
  sortFields: ['name', 'type', 'address', 'isSisterCompany', 'version', 'updatedAt'],
  filterFields: {
    search: z.string().trim().min(1).max(100).optional(),
    isSisterCompany: booleanFilter,
  },
  pagination,
} as const;

export const SERVICE_LIST_CONFIG = {
  sortFields: ['name', 'type', 'isActive'],
  filterFields: {
    type: z.nativeEnum(ServiceType).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    isActive: booleanFilter,
    hasMaintenance: booleanFilter,
  },
  pagination,
} as const;

export const ITEM_LIST_CONFIG = {
  sortFields: ['name', 'serviceName'],
  filterFields: {
    name: z.string().trim().min(1).max(200).optional(),
    serviceName: z.string().trim().min(1).max(200).optional(),
  },
  pagination,
} as const;

export const ITEM_SIZE_LIST_CONFIG = {
  sortFields: ['size'],
  filterFields: {
    notIn: z.string().transform((value) => value.split(',').map((id) => id.trim()))
      .pipe(z.array(z.string().uuid()).min(1).max(100)).optional(),
    size: z.string().trim().min(1).max(100).optional(),
    itemName: z.string().trim().min(1).max(200).optional(),
    serviceName: z.string().trim().min(1).max(200).optional(),
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
