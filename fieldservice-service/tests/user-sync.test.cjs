const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.DIRECT_MFE_ACCESS = 'false';
process.env.DATABASE_URL ??= 'postgresql://postgres:password@localhost:5432/akura_fieldservice?schema=public';
process.env.GATEWAY_SECRET ??= 'test-service-secret';
process.env.API_GATEWAY_URL ??= 'http://127.0.0.1:1';
process.env.USER_SYNC_SECRET = 'test-user-sync-secret-with-32-chars!!!!';

const { prisma } = require('../dist/config/db.js');
const { applyFieldServiceUserSyncEvent, listInspectorOptions } = require('../dist/modules/user-sync/user-sync.repository.js');

const snapshot = (branch, patch = {}) => ({
  id: randomUUID(), username: 'inspector', firstName: 'Budi', lastName: 'Tester',
  email: null, telp: null, role: 'USER', section: 'FIELD_SERVICE', officeBranchId: branch,
  isActive: true, version: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch,
});

test('Field Service user sync stores active FIELD_SERVICE users, is idempotent and isolates branches', async () => {
  const branch = randomUUID(), otherBranch = randomUUID(), user = snapshot(branch);
  const send = (version, patch = {}, officeBranchId = user.officeBranchId) => {
    const snap = { ...user, ...patch, version, officeBranchId };
    return applyFieldServiceUserSyncEvent({ eventId: randomUUID(), officeBranchId, version, user: snap });
  };
  try {
    await send(1);
    assert.deepEqual(await listInspectorOptions(branch), [user], 'options return the raw stored Auth snapshot');
    assert.deepEqual(await listInspectorOptions(otherBranch), [], 'other branches never see this user');

    // Losing eligibility removes the row but records the revision.
    await send(2, { section: 'FINANCE' });
    assert.deepEqual(await listInspectorOptions(branch), []);
    assert.equal((await prisma.fieldServiceUserSyncRevision.findUnique({ where: { userId: user.id } })).version, 2);

    // Re-eligible, then a stale/reordered retry must not resurrect or delete.
    await send(3);
    await send(1);
    assert.equal((await listInspectorOptions(branch)).length, 1, 'stale event is acknowledged without changing the row');

    // Ineligible identity variants are removed.
    for (const patch of [{ isActive: false }, { officeBranchId: null }, { section: 'MARKETING' }]) {
      await send(4, patch, patch.officeBranchId === null ? null : user.officeBranchId);
      assert.equal((await prisma.fieldServiceUser.count({ where: { id: user.id } })), 0);
    }

    // Invalid payloads are rejected before touching the read model.
    await assert.rejects(() => applyFieldServiceUserSyncEvent({}));
    await assert.rejects(() => applyFieldServiceUserSyncEvent({
      eventId: randomUUID(), officeBranchId: randomUUID(), version: 9, user: { ...user, version: 9 },
    }), error => error.statusCode === 400);
    await assert.rejects(() => applyFieldServiceUserSyncEvent({
      eventId: randomUUID(), officeBranchId: user.officeBranchId, version: 10,
      user: { ...user, section: 'ADMIN', version: 10 },
    }), error => error.statusCode === 400);
    console.log('PASS: Field Service user sync eligibility, idempotency, branch isolation and validation.');
  } finally {
    await prisma.fieldServiceUser.deleteMany({ where: { id: user.id } });
    await prisma.fieldServiceUserSyncRevision.deleteMany({ where: { userId: user.id } });
  }
});

test('Field Service user sync HTTP receiver authenticates with the shared secret', async () => {
  const routes = require('../dist/modules/user-sync/user-sync.routes.js').default;
  const app = express();
  app.use(express.json());
  app.use(routes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}/internal/users/events`;
  const branch = randomUUID(), user = snapshot(branch);
  const event = { eventId: randomUUID(), officeBranchId: branch, version: 1, user };
  const secret = process.env.USER_SYNC_SECRET;
  const send = async (body, supplied = secret) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-sync-secret': supplied }, body: JSON.stringify(body) });
    return { status: response.status, payload: await response.json() };
  };
  try {
    assert.equal((await send(event, 'wrong')).status, 403, 'shared secret is required');
    assert.equal(await prisma.fieldServiceUser.count({ where: { id: user.id } }), 0);
    assert.equal((await send({})).status, 400);
    const accepted = await send(event);
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.payload, { success: true, eventId: event.eventId });
    assert.equal(await prisma.fieldServiceUser.count({ where: { id: user.id } }), 1);
    // A duplicate retry stays idempotent.
    await send({ ...event, eventId: randomUUID() });
    assert.equal(await prisma.fieldServiceUser.count({ where: { id: user.id } }), 1);
    console.log('PASS: Field Service user sync receiver authenticates and acknowledges after commit.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.fieldServiceUser.deleteMany({ where: { id: user.id } });
    await prisma.fieldServiceUserSyncRevision.deleteMany({ where: { userId: user.id } });
  }
});
