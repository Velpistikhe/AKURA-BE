const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildQuotationListWhere } = require('../dist/modules/quotations/quotation.repository.js');

const branch = '00000000-0000-4000-8000-000000000001';
const base = { page: 1, limit: 20 };

test('active visibility includes superseded inactive REVISED quotations', () => {
  const where = buildQuotationListWhere({ ...base, isActive: true }, branch);
  assert.equal(where.officeBranchId, branch);
  assert.deepEqual(where.AND, [{ OR: [{ isActive: true }, { status: 'REVISED' }] }]);
});

test('inactive-only visibility hides active rows, and no filter sees both states', () => {
  assert.deepEqual(buildQuotationListWhere({ ...base, isActive: false }, branch).AND, [{ isActive: false }]);
  assert.deepEqual(buildQuotationListWhere(base, branch), { officeBranchId: branch });
});

test('status=REVISED still matches under forced active visibility', () => {
  const where = buildQuotationListWhere({ ...base, isActive: true, status: 'REVISED' }, branch);
  assert.deepEqual(where.AND, [
    { OR: [{ isActive: true }, { status: 'REVISED' }] },
    { status: 'REVISED' },
  ]);
});

test('all list filters compose inside the office branch scope', () => {
  const dateFrom = new Date('2026-01-01T00:00:00.000Z');
  const dateTo = new Date('2026-01-31T00:00:00.000Z');
  const where = buildQuotationListWhere(
    { ...base, dateFrom, dateTo, no: 12, status: 'APPROVED', company: 'akura', invoiceStatus: 'SEND' },
    branch,
    ['company-id'],
  );
  assert.deepEqual(where, {
    officeBranchId: branch,
    AND: [{ date: { gte: dateFrom, lte: dateTo }, no: 12, status: 'APPROVED', invoiceStatus: 'SEND', id: { in: ['company-id'] } }],
  });
});

test('company filter without resolved IDs returns an empty result set', () => {
  assert.deepEqual(buildQuotationListWhere({ ...base, company: 'missing' }, branch).AND, [{ id: { in: [] } }]);
});