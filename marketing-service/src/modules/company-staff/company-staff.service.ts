import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { normalizeName } from '../../utils/normalizeName.js';
import { companyStaffRepository } from './company-staff.repository.js';
import { CreateCompanyStaffInput, ListCompanyStaffInput, UpdateCompanyStaffInput } from './company-staff.schemas.js';

const ensureCompany = async (companyId: string): Promise<void> => {
  if (!await prisma.company.findFirst({ where: { id: companyId, revoked: false }, select: { id: true } })) throw new HttpError('Company not found', 404);
};

export const companyStaffService = {
  list: (input: ListCompanyStaffInput) => companyStaffRepository.list(input),
  async get(id: string) {
    const staff = await companyStaffRepository.findById(id);
    if (!staff) throw new HttpError('Company staff not found', 404);
    return staff;
  },
  async create(data: CreateCompanyStaffInput) {
    await ensureCompany(data.companyId);
    const normalized = normalizeName(data.name);
    if (await companyStaffRepository.findByNormalizeName(normalized)) throw new HttpError('Company staff name already exists', 409);
    return companyStaffRepository.create({ ...data, normalizeName: normalized });
  },
  async update(id: string, data: UpdateCompanyStaffInput) {
    const current = await companyStaffRepository.findById(id);
    if (!current) throw new HttpError('Company staff not found', 404);
    if (data.companyId) await ensureCompany(data.companyId);
    const normalized = data.name ? normalizeName(data.name) : undefined;
    if (normalized && await companyStaffRepository.findByNormalizeName(normalized, id)) throw new HttpError('Company staff name already exists', 409);
    return companyStaffRepository.update(id, { ...data, ...(normalized && { normalizeName: normalized }) });
  },
  async delete(id: string) {
    if (!await companyStaffRepository.findById(id)) throw new HttpError('Company staff not found', 404);
    return companyStaffRepository.revoke(id);
  },
};
