import { OfficeBranch } from '@prisma/client';

export type ManagedOfficeBranch = Pick<
  OfficeBranch,
  'id' | 'name' | 'address' | 'telp' | 'email' | 'isHead' | 'createdAt' | 'updatedAt'
>;

export interface PaginatedOfficeBranches {
  officeBranches: ManagedOfficeBranch[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export type OfficeBranchOption = Pick<OfficeBranch, 'id' | 'name'>;
