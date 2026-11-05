import { Response } from 'express';
import { HttpError } from '../../../utils/httpError.js';
import { getAuditActor } from '../../../utils/audit.js';
import { CreateOfficeBranchInput, ListOfficeBranchesInput, UpdateOfficeBranchInput } from './office-branch.schemas.js';
import { officeBranchRepository } from './office-branch.repository.js';
import { ManagedOfficeBranch, OfficeBranchOption, PaginatedOfficeBranches } from './office-branch.types.js';

class OfficeBranchService {
  listOptions(): Promise<OfficeBranchOption[]> {
    return officeBranchRepository.listOptions();
  }

  list(input: ListOfficeBranchesInput): Promise<PaginatedOfficeBranches> {
    return officeBranchRepository.list(input);
  }

  async get(id: string): Promise<ManagedOfficeBranch> {
    const officeBranch = await officeBranchRepository.findById(id);
    if (!officeBranch) throw new HttpError('Office branch not found', 404);
    return officeBranch;
  }

  async create(data: CreateOfficeBranchInput, res: Response): Promise<ManagedOfficeBranch> {
    return officeBranchRepository.create(data, getAuditActor(res));
  }

  async update(id: string, data: UpdateOfficeBranchInput, res: Response): Promise<ManagedOfficeBranch> {
    if (!await officeBranchRepository.findById(id)) throw new HttpError('Office branch not found', 404);
    return officeBranchRepository.update(id, data, getAuditActor(res));
  }
}

export const officeBranchService = new OfficeBranchService();
