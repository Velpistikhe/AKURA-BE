const { test } = require('node:test');
const assert = require('node:assert/strict');
require('dotenv').config();
const { prisma } = require('../dist/config/db.js');
const { serviceRepository } = require('../dist/modules/services/service.repository.js');
const { contractRepository } = require('../dist/modules/contracts/contract.repository.js');
const { quotationRepository } = require('../dist/modules/quotations/quotation.repository.js');
const actor = { id: 'actor', name: 'Delete Test', role: 'ADMIN', section: 'MARKETING' };

test('Service delete distinguishes missing rows and stale versions without writing', async t => {
  const original = prisma.$transaction;
  let current = null;
  prisma.$transaction = async action => action({ $executeRaw: async () => 1, service: { findFirst: async () => current } });
  t.after(() => { prisma.$transaction = original; });
  await assert.rejects(() => serviceRepository.deactivate('id', 0, 'branch', actor), e => e.statusCode === 404);
  current = { version: 1, isActive: true };
  await assert.rejects(() => serviceRepository.deactivate('id', 0, 'branch', actor), e => e.statusCode === 409);
});

test('Deleting a missing quotation item returns 404 within the caller branch', async t => {
  const original = prisma.$transaction;
  prisma.$transaction = async action => action({
    $executeRaw: async () => 1, $queryRaw: async () => [],
    quotation: { findFirst: async ({ where }) => {
      assert.equal(where.officeBranchId, 'branch');
      return { isActive: true, status: 'CREATED', version: 0 };
    } },
    quotationItem: { findFirst: async ({ where }) => {
      assert.equal(where.quotationId, 'quotation');
      return null;
    } },
  });
  t.after(() => { prisma.$transaction = original; });
  await assert.rejects(() => quotationRepository.deleteItem('quotation', 'missing',
    { quotationVersion: 0, itemVersion: 0 }, 'branch', actor), e => e.statusCode === 404);
});

test('Repeated scope deletion and contract deletion reject without new history or writes', async t => {
  const original = prisma.$transaction;
  const tx = {
    $executeRaw: async () => 1,
    service: { findFirst: async () => ({ isActive: true, hasMaintenance: true }) },
    maintenanceScope: { findFirst: async () => ({ id: 'scope', revoked: true }) },
    inspectionScope: { findFirst: async () => ({ id: 'scope', revoked: true }) },
    companyContract: { findFirst: async () => ({ status: 'DRAFT', version: 1, isDeleted: true }) },
  };
  prisma.$transaction = async action => action(tx);
  t.after(() => { prisma.$transaction = original; });
  for (const action of [
    () => serviceRepository.revokeMaintenanceScope('service', 'scope', 'branch', actor),
    () => serviceRepository.revokeInspectionScope('service', 'scope', 'branch', actor),
    () => contractRepository.delete('contract', 1, 'branch', actor),
  ]) await assert.rejects(action, e => e.statusCode === 409);
});
