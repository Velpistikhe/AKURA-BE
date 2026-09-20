const assert = require('node:assert/strict');
const { test } = require('node:test');
const { prisma } = require('../dist/config/db.js');
const { contractRepository: contracts } = require('../dist/modules/contracts/contract.repository.js');
const { createContractSchema, updateContractSchema } = require('../dist/modules/contracts/contract.schemas.js');
const { currentBusinessDate } = require('../dist/utils/businessDate.js');

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
  ...payload(), id: 'old', contractNumber: 'OLD', version: 0, status: 'ACTIVE', isActive: true, activeKey: input.companyId, ...extra,
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
      if ('in' in value) return value.in.includes(row[key]);
    }
    return row[key] === value;
  });
  const tx = {
    $executeRaw: async () => { locked = true; },
    company: { findFirst: async ({ where }) => {
      assert(locked);
      return where.officeBranchId === 'branch' && where.id === input.companyId ? { id: input.companyId } : null;
    } },
    companyContract: {
      findFirst: async ({ where }) => { assert(locked); return rows.find(row => matches(row, where)) || null; },
      findMany: async ({ where }) => { assert(locked); return rows.filter(row => matches(row, where)); },
      create: async ({ data }) => {
        assert(locked);
        const row = { id: `new-${rows.length}`, version: 0, isActive: true, ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        assert(locked);
        const index = rows.findIndex(row => matches(row, where));
        assert(index >= 0);
        const row = { ...rows[index], ...data, version: rows[index].version + data.version.increment };
        rows[index] = row;
        return row;
      },
    },
    companyContractHistory: { create: async ({ data }) => { history.push(data); } },
    catalogAuditLog: { create: async ({ data }) => { audit.push(data); } },
  };
  t.mock.method(prisma, '$transaction', async callback => callback(tx));
  return { rows: () => rows, history, audit };
}

test('create accepts future dates and preserves approval workflow', async t => {
  const db = database(t);
  const row = await contracts.create(payload(), 'branch', actor, false);
  assert.equal(row.status, 'CREATE');
  assert.equal(row.effectiveFrom.toISOString(), '2090-02-01T00:00:00.000Z');
  assert.equal(db.history[0].action, 'CREATE');
  await contracts.approve(row.id, 0, 'branch', actor);
  assert.equal(db.rows()[0].status, 'ACTIVE');
});

for (const status of ['CREATE', 'ACTIVE']) {
  for (const effectiveFrom of [new Date('2020-01-01'), new Date('2095-01-01')]) {
    test(`create rejects existing ${status} starting ${effectiveFrom.getUTCFullYear()}, even without overlap`, async t => {
      const db = database(t, [original({ status, effectiveFrom, effectiveUntil: new Date('2099-01-01') })]);
      await assert.rejects(contracts.create(payload(), 'branch', actor, true), conflict);
      assert.equal(db.rows().length, 1);
      assert.equal(db.history.length, 0);
    });
  }
}

test('historical inactive contracts do not block creation', async t => {
  const db = database(t, [original({ status: 'TERMINATED', isActive: false })]);
  const row = await contracts.create(payload(), 'branch', actor, true);
  assert.equal(row.status, 'ACTIVE');
  assert.equal(db.rows().filter(row => row.isActive).length, 1);
});

test('approval rejects another contract even when periods do not overlap', async t => {
  database(t, [original({ status: 'CREATE' }), original({ id: 'future', effectiveFrom: new Date('2095-01-01') })]);
  await assert.rejects(contracts.approve('old', 0, 'branch', actor), conflict);
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
  await assert.rejects(contracts.revise('old', { ...revision(), contractNumber: 'OLD' }, 'branch', actor), conflict);
  assert.equal(db.history.length, 0);
  assert.equal(db.rows()[0].isActive, true);
});

test('revision creates a new identity and closes current, future and pending legacy contracts', async t => {
  const db = database(t, [original({ effectiveFrom: new Date('2020-01-01') }), original({ id: 'future' }), original({ id: 'pending', status: 'CREATE' })]);
  const row = await contracts.revise('old', revision(), 'branch', actor);
  const yesterday = new Date(input.effectiveFrom);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  assert.notEqual(row.id, 'old');
  assert.equal(row.contractNumber, 'NEW');
  assert.equal(row.status, 'ACTIVE');
  assert.equal(db.rows().filter(row => row.isActive).length, 1);
  for (const old of db.rows().filter(old => old.id !== row.id)) {
    assert.equal(old.status, 'TERMINATED');
    assert.deepEqual(old.effectiveUntil, yesterday);
    assert.equal(old.version, 1);
  }
  assert.equal(db.history.length, 4);
  assert(db.history.every(entry => entry.action === 'REVISED'));
  assert(db.audit.every(entry => entry.action === 'REVISED'));
});

test('future contract can be revised without waiting for its start date', async t => {
  database(t, [original()]);
  const row = await contracts.revise('old', revision(), 'branch', actor);
  assert.equal(row.contractNumber, 'NEW');
});

test('stale revision cannot close the current contract', async t => {
  const db = database(t, [original({ version: 1 })]);
  await assert.rejects(contracts.revise('old', revision(), 'branch', actor), conflict);
  assert.equal(db.rows()[0].isActive, true);
  assert.equal(db.history.length, 0);
});
