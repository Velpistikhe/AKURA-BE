import { AuditActor } from '../../types/auth.types.js';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { normalizeName } from '../../utils/normalizeName.js';
import { companyStaffRepository } from './company-staff.repository.js';
import { CreateCompanyStaffInput, ListCompanyStaffInput, UpdateCompanyStaffInput } from './company-staff.schemas.js';

const ensureCompany = async (companyId: string, officeBranchId: string): Promise<void> => {
  if (!await prisma.company.findFirst({ where: { id: companyId, officeBranchId, revoked: false }, select: { id: true } })) throw new HttpError('Company not found', 404);
};

export const companyStaffService = {
  history: (id: string, officeBranchId: string, input: { page: number; limit: number }) => companyStaffRepository.history(id, officeBranchId, input),
  list: (input: ListCompanyStaffInput, officeBranchId: string) => companyStaffRepository.list(input, officeBranchId),
  async get(id: string, officeBranchId: string) {
    const staff = await companyStaffRepository.findById(id, officeBranchId);
    if (!staff) throw new HttpError('Company staff not found', 404);
    return staff;
  },
  async create(data: CreateCompanyStaffInput, officeBranchId: string, actor: AuditActor) {
    await ensureCompany(data.companyId, officeBranchId);
    const normalized = normalizeName(data.name);
    if (await companyStaffRepository.findByNormalizeName(normalized, officeBranchId)) throw new HttpError('Company staff name already exists', 409);
    return companyStaffRepository.create({ ...data, normalizeName: normalized }, officeBranchId, actor);
  },
  async update(id: string, data: UpdateCompanyStaffInput, officeBranchId: string, actor: AuditActor) {
    const normalized = data.name ? normalizeName(data.name) : undefined;
    if (normalized && await companyStaffRepository.findByNormalizeName(normalized, officeBranchId, id)) throw new HttpError('Company staff name already exists', 409);
    return companyStaffRepository.update(id, officeBranchId, { ...data, ...(normalized && { normalizeName: normalized }) }, actor);
  },
  async delete(id: string, officeBranchId: string, version: number, actor: AuditActor) {
    return companyStaffRepository.revoke(id, officeBranchId, version, actor);
  },
};
