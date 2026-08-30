import { HttpError } from '../../utils/httpError.js';
import { normalizeName } from '../../utils/normalizeName.js';
import { CreateCompanyInput, ListCompaniesInput, UpdateCompanyInput } from './company.schemas.js';
import { companyRepository } from './company.repository.js';

export const companyService = {
  list: (input: ListCompaniesInput) => companyRepository.list(input),
  async get(id: string) {
    const company = await companyRepository.findById(id);
    if (!company) throw new HttpError('Company not found', 404);
    return company;
  },
  async create(data: CreateCompanyInput) {
    const normalized = normalizeName(data.name);
    if (await companyRepository.findByNormalizeName(normalized)) throw new HttpError('Company name already exists', 409);
    return companyRepository.create({ ...data, normalizeName: normalized });
  },
  async update(id: string, data: UpdateCompanyInput) {
    const current = await companyRepository.findById(id);
    if (!current) throw new HttpError('Company not found', 404);
    return companyRepository.createVersion(id, { ...data, normalizeName: normalizeName(data.name ?? current.name) });
  },
  async delete(id: string) {
    const current = await companyRepository.findById(id);
    if (!current) throw new HttpError('Company not found', 404);
    return companyRepository.revoke(id);
  },
};
