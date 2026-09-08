import { HttpError } from '../../utils/httpError.js';
import { normalizeName } from '../../utils/normalizeName.js';
import { CreateCompanyInput, ListCompaniesInput, UpdateCompanyInput } from './company.schemas.js';
import { companyRepository } from './company.repository.js';

export const companyService = {
  list: (input: ListCompaniesInput, officeBranchId: string) => companyRepository.list(input, officeBranchId),
  async get(id: string, officeBranchId: string) {
    const company = await companyRepository.findById(id, officeBranchId);
    if (!company) throw new HttpError('Company not found', 404);
    return company;
  },
  async create(data: CreateCompanyInput, officeBranchId: string) {
    const normalized = normalizeName(data.name);
    if (await companyRepository.findByNormalizeName(normalized, officeBranchId)) throw new HttpError('Company name already exists', 409);
    return companyRepository.create({ ...data, normalizeName: normalized, officeBranchId });
  },
  async update(id: string, data: UpdateCompanyInput, officeBranchId: string) {
    const current = await companyRepository.findById(id, officeBranchId);
    if (!current) throw new HttpError('Company not found', 404);
    return companyRepository.createVersion(id, officeBranchId, { ...data, normalizeName: normalizeName(data.name ?? current.name) });
  },
  async delete(id: string, officeBranchId: string) {
    const current = await companyRepository.findById(id, officeBranchId);
    if (!current) throw new HttpError('Company not found', 404);
    return companyRepository.revoke(id, officeBranchId);
  },
};
