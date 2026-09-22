const assert = require('node:assert/strict');
const { test } = require('node:test');
const { prisma } = require('../dist/config/db.js');
const { contractRepository: contracts } = require('../dist/modules/contracts/contract.repository.js');
const { createContractSchema, updateContractSchema } = require('../dist/modules/contracts/contract.schemas.js');

const actor = { id: 'actor', name: 'Contract test' };
const input = {
  companyId: '00000000-0000-4000-8000-000000000001', contractNumber: 'NEW',
  contractDate: '2090-01-01', effectiveFrom: '2090-02-01', effectiveUntil: '2091-01-01',
};
const payload = () => createContractSchema.parse(input);
const revision = () => {
  const { companyId, ...fields } = input;
  return updateContractSchema.parse({ ...fields, version: 0 });
};
const original = (extra = {}) => ({
  ...payload(), id: 'old', contractNumber: 'OLD', version: 0, status: 'APPROVED', isDeleted: false, ...extra,
});
const conflict = error => error.statusCode === 409;

function database(t, initial = []) {
  let rows = structuredClone(initial);
  const history = [], audit = [];
  let locked = false;
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'company') return value.officeBranchId === 'branch' && value.revoked === false;
    if (value && typeof value === 'object') {
      if ('not' in value) return row[key] !== value.not;
      if ('notIn' in value) return !value.notIn.includes(row[key]);
      if ('in' in value) return value.in.includes(row[key]);
      if ('lt' in value) return row[key] < value.lt;
      if ('gt' in value) return row[key] > value.gt;
    }
    return row[key] === value;
  });
  const tx = {
    $executeRaw: async () => { locked = true; },
    company: { findFirst: async ({ where }) => {
      assert(locked);
      return where.officeBranchId === 'branch' && where.id === input.companyId ? { id: input.companyId, name: 'Customer', type: 'PT', version: 0 } : null;
    } },
    companyContract: {
      findFirst: async ({ where }) => { assert(locked); return rows.find(row => matches(row, where)) || null; },
      findMany: async ({ where }) => { assert(locked); return rows.filter(row => matches(row, where)); },
      findUnique: async ({ where }) => rows.find(row => row.id === where.id) || null,
      create: async ({ data }) => {
        assert(locked);
        const row = { id: `new-${rows.length}`, version: 0, isDeleted: false, ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        assert(locked);
        const index = rows.findIndex(row => matches(row, where));
        assert(index >= 0);
        const row = { ...rows[index], ...data, version: rows[index].version + (data.version?.increment ?? 0) };
        rows[index] = row;
        return row;
      },
    },
    companyContractPrice: { findFirst: async ({ where }) => rows.some(row => row.id === where.contractId) ? { id: 'price' } : null },
    companyContractHistory: { create: async ({ data }) => { history.push(data); } },
    catalogAuditLog: { create: async ({ data }) => { audit.push(data); } },
  };
  t.mock.method(prisma, '$transaction', async callback => callback(tx));
  return { rows: () => rows, history, audit };
}

test('create produces a DRAFT and approval transitions through SUBMITTED to APPROVED', async t => {
  const db = database(t);
  const row = await contracts.create(payload(), 'branch', actor, false);
  assert.equal(row.status, 'DRAFT');
  assert.equal(row.isDeleted, false);
  await assert.rejects(contracts.approve(row.id, 0, 'branch', actor), conflict);
  await contracts.submit(row.id, 0, 'branch', actor);
  assert.equal(db.rows()[0].status, 'SUBMITTED');
  await contracts.approve(row.id, 1, 'branch', actor);
  assert.equal(db.rows()[0].status, 'APPROVED');
});

for (const status of ['DRAFT', 'REJECTED']) {
  test(`create rejects an existing ${status} contract`, async t => {
    const db = database(t, [original({ status })]);
    await assert.rejects(contracts.create(payload(), 'branch', actor, true), conflict);
    assert.equal(db.rows().length, 1);
    assert.equal(db.history.length, 0);
  });
}

test('terminated contracts do not block a new DRAFT', async t => {
  const db = database(t, [original({ status: 'TERMINATED', isDeleted: true })]);
  const row = await contracts.create(payload(), 'branch', actor, true);
  assert.equal(row.status, 'DRAFT');
  assert.equal(db.rows().filter(row => !row.isDeleted).length, 1);
});

test('approved contracts are date-active only during their effective period', async t => {
  const db = database(t, [original({ effectiveFrom: new Date('2020-01-01'), effectiveUntil: new Date('2099-01-01') })]);
  assert.equal(db.rows()[0].status, 'APPROVED');
  assert.equal(db.rows()[0].isDeleted, false);
  assert(new Date('2026-01-01') >= db.rows()[0].effectiveFrom);
  assert(new Date('2026-01-01') < db.rows()[0].effectiveUntil);
});

test('create and revision reject a different branch before writing', async t => {
  const db = database(t, [original()]);
  await assert.rejects(contracts.create(payload(), 'other', actor, true), error => error.statusCode === 404);
  await assert.rejects(contracts.revise('old', revision(), 'other', actor), error => error.statusCode === 404);
  assert.equal(db.history.length, 0);
});

test('revision requires a new number and complete contract fields', async t => {
  const db = database(t, [original()]);
  assert.equal(updateContractSchema.safeParse({ version: 0, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil }).success, false);
  const row = await contracts.revise('old', { ...revision(), contractNumber: 'NEW' }, 'branch', actor);
  assert.equal(row.status, 'DRAFT');
  assert.equal(db.rows()[0].status, 'APPROVED');
});

test('revision creates a new DRAFT identity without changing the APPROVED contract', async t => {
  const db = database(t, [original()]);
  const row = await contracts.revise('old', revision(), 'branch', actor);
  assert.notEqual(row.id, 'old');
  assert.equal(row.contractNumber, 'NEW');
  assert.equal(row.status, 'DRAFT');
  assert.equal(db.rows()[0].status, 'APPROVED');
  assert.equal(db.history.length, 1);
});

test('stale revision cannot create a draft', async t => {
  const db = database(t, [original({ version: 1 })]);
  await assert.rejects(contracts.revise('old', revision(), 'branch', actor), conflict);
  assert.equal(db.rows().length, 1);
  assert.equal(db.history.length, 0);
});
