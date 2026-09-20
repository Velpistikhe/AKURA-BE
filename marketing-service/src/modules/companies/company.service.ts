import { HttpError } from '../../utils/httpError.js';

import { normalizeName } from '../../utils/normalizeName.js';
import { CreateCompanyInput, ListCompaniesInput, UpdateCompanyInput } from './company.schemas.js';
import { companyRepository } from './company.repository.js';
import { AuditActor } from '../../types/auth.types.js';

export const companyService = {
  list: (input: ListCompaniesInput, officeBranchId: string) => companyRepository.list(input, officeBranchId),
  async get(id: string, officeBranchId: string) {
    const company = await companyRepository.findById(id, officeBranchId);
    if (!company) throw new HttpError('Company not found', 404);
    return company;
  },
  async create(data: CreateCompanyInput, officeBranchId: string, actor: AuditActor) {
    const normalized = normalizeName(data.name);
    if (await companyRepository.findByNormalizeName(normalized, officeBranchId)) throw new HttpError('Company name already exists', 409);
    return companyRepository.create({ ...data, normalizeName: normalized, officeBranchId }, actor);
  },
  async update(id: string, data: UpdateCompanyInput, officeBranchId: string, actor: AuditActor) {
    return companyRepository.update(id, officeBranchId, data, actor);
  },
};
