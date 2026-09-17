const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('HTTP tax delivery works without starting a timer worker', async () => {
  const jobs = [];
  const calls = [];
  let fail = false;
  let unavailable = false;
  let committed = false;
  const branch = 'branch-a';
  function enqueue(officeBranchId = branch) {
    const id = String(jobs.length + 1);
    const event = { id, officeBranchId, version: jobs.length + 1, payload: [] };
    jobs.push({ id, eventId: id, event, targetService: 'marketing-service', deliveredAt: null,
      attempts: 0, lastError: null, nextRetryAt: new Date(0) });
    committed = true;
    return event;
  }
  const prisma = {
    $executeRaw: async () => {},
    $queryRaw: async () => [{ acquired: true }],
    $transaction: async callback => callback(prisma),
    taxDelivery: {
      findMany: async ({ where, take, skip = 0 }) => {
        if (unavailable) throw Error('Database temporarily unavailable');
        const rows = jobs.filter(job => (!where.event || job.event.officeBranchId === where.event.officeBranchId)
          && (where.deliveredAt === undefined || job.deliveredAt === where.deliveredAt)
          && (!where.nextRetryAt || job.nextRetryAt <= where.nextRetryAt.lte)
          && (!where.eventId || job.eventId === where.eventId));
        return rows.slice(skip, take === undefined ? undefined : skip + take);
      },
      findUnique: async ({ where }) => jobs.find(job => job.id === where.id),
      update: async ({ where, data }) => {
        const job = jobs.find(job => job.id === where.id);
        const attempts = job.attempts + data.attempts.increment;
        Object.assign(job, data, { attempts });
        return job;
      },
    },
  };
  const mock = (module, exports) => {
    const id = require.resolve(module);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  mock('../dist/config/db.js', { prisma });
  mock('../dist/config/env.js', { env: {
    TAX_DELIVERY_TARGETS: [{ name: 'marketing-service', url: 'https://marketing.example/internal/taxes/events' }],
    TAX_SYNC_SECRET: 'test-only-secret',
  } });
  mock('../dist/utils/logger.js', { logger: { warn() {}, error() {} } });
  mock('../dist/middlewares/actor.middleware.js', { requireActor: (_req, res, next) => {
    res.locals.documentActor = { id: 'admin', name: 'Finance admin', officeBranchId: branch };
    res.locals.taxWriteAllowed = true;
    next();
  } });
  mock('../dist/modules/taxes/tax.repository.js', {
    taxRepository: { createWithEvent: async () => ({ tax: { id: 'tax-1' }, event: enqueue() }) },
    enqueueTaxSnapshot: async (_tx, officeBranchId) => enqueue(officeBranchId),
  });
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
    assert.equal(committed, true, 'outbox committed before HTTP delivery');
    assert.equal(options.headers['x-tax-sync-secret'], 'test-only-secret');
    const event = JSON.parse(options.body);
    calls.push(event);
    await new Promise(resolve => setTimeout(resolve, 10));
    if (fail) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ success: true, eventId: event.eventId }) };
  };
  const app = express();
  app.use(express.json());
  app.use('/taxes', require('../dist/modules/taxes/tax.routes.js').default);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/taxes`;
  try {
    const foreign = enqueue('branch-b');
    let response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 201);
    assert.ok(jobs[1].deliveredAt, 'delivery completed before create response, with worker stopped');
    assert.equal(jobs[0].attempts, 0, 'other branch is not processed');
    fail = true;
    response = await fetch(`${base}/resync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 202, 'delivery failure does not undo committed tax event');
    const retry = jobs[2];
    assert.equal(retry.attempts, 1);
    assert.equal(retry.lastError, 'Receiver returned HTTP 503');
    assert.ok(retry.nextRetryAt > new Date());
    await fetch(`${base}/deliveries`);
    assert.equal(retry.attempts, 1, 'refresh respects backoff');
    fail = false;
    retry.nextRetryAt = new Date(0);
    response = await fetch(`${base}/deliveries`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.data.find(job => job.id === retry.id).deliveredAt, 'refresh recovers pending jobs before returning status');
    assert.equal(retry.attempts, 2);
    const { processDueTaxDeliveries } = require('../dist/modules/taxes/tax-delivery.js');
    for (let i = 0; i < 8; i++) enqueue();
    const before = calls.length;
    await processDueTaxDeliveries(branch);
    assert.equal(calls.length - before, 5, 'request batch is bounded');
    assert.ok(!calls.some(event => event.eventId === foreign.id));
    for (let i = 0; i < 8; i++) enqueue();
    response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 201);
    assert.ok(jobs.at(-1).deliveredAt, 'new tax is delivered immediately even with an older backlog');
    unavailable = true;
    response = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 201, 'outbox lookup failure does not report committed create as failed');
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
  }
});
