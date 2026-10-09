import assert from 'node:assert/strict';
import { enqueueUserSync } from '../dist/modules/user-sync/user-sync.service.js';
import { retryDelay } from '../dist/modules/user-sync/user-sync.delivery.js';

// Outbox enqueue writes the full snapshot plus a delivery row in the caller's
// transaction (mirrors the transactional contract used by user mutations).
const created = [];
const tx = {
  userSyncEvent: {
    create: async ({ data }) => {
      created.push(data);
      return { id: 'event-id', ...data, deliveries: { length: 1 } };
    },
  },
};
const user = {
  id: '00000000-0000-4000-8000-000000000001', username: 'admin', firstName: 'Artha', lastName: 'Marketing',
  email: 'artha@akura.test', telp: null, role: 'ADMIN', section: 'MARKETING',
  officeBranchId: '00000000-0000-4000-8000-000000000002', isActive: true,
  version: 4, createdAt: new Date(), updatedAt: new Date(),
};
const eventId = await enqueueUserSync(tx, user);
assert.equal(typeof eventId, 'string');
assert.equal(created.length, 1);
assert.equal(created[0].userId, user.id);
assert.equal(created[0].version, user.version);
assert.deepEqual(JSON.parse(JSON.stringify(created[0].payload)), JSON.parse(JSON.stringify(user)));
assert.equal(Object.hasOwn(created[0].payload, 'normalizeUsername'), false, 'internal normalizeUsername must not enter sync payload');
// Marketing always receives an event; Field Service only when eligible.
assert.deepEqual(created[0].deliveries.create, [{ targetService: 'marketing-service' }]);

const fieldServiceUser = {
  id: '00000000-0000-4000-8000-000000000003', username: 'inspector', firstName: 'Budi', lastName: 'Inspector',
  email: null, telp: null, role: 'USER', section: 'FIELD_SERVICE',
  officeBranchId: '00000000-0000-4000-8000-000000000002', isActive: true,
  version: 1, createdAt: new Date(), updatedAt: new Date(),
};
await enqueueUserSync(tx, fieldServiceUser);
assert.deepEqual(created[1].deliveries.create, [
  { targetService: 'marketing-service' },
  { targetService: 'fieldservice-service' },
]);
// Losing FIELD_SERVICE eligibility still delivers a removal event to Field Service.
await enqueueUserSync(tx, { ...fieldServiceUser, section: 'MARKETING' }, { previous: fieldServiceUser });
assert.deepEqual(created[2].deliveries.create, [
  { targetService: 'marketing-service' },
  { targetService: 'fieldservice-service' },
]);
// A user never eligible for Field Service does not create a Field Service delivery.
await enqueueUserSync(tx, { ...user, role: 'USER', section: 'FINANCE' }, { previous: { ...user, role: 'USER', section: 'FINANCE' } });
assert.deepEqual(created[3].deliveries.create, [{ targetService: 'marketing-service' }]);

// Source-level guard: every enqueue caller must wake the delivery worker after
// the transaction commits; otherwise events wait until the next restart.
import { readFileSync } from 'node:fs';
for (const file of ['../src/modules/auth/auth.service.ts', '../src/modules/user-management/user-management.service.ts']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source, /wakeUserSync\(\);/, `${file} must wake the user-sync worker after enqueue`);
  assert.ok(source.indexOf('wakeUserSync();') > source.indexOf('enqueueUserSync('), `${file} must wake the worker after the outbox row is committed`);
}

// Profile updates must enqueue only eligible Marketing administrators or
// Field Service users and log the non-eligible branch explicitly.
const authSource = readFileSync(new URL('../src/modules/auth/auth.service.ts', import.meta.url), 'utf8');
assert.match(authSource, /isMarketingUserSyncCandidate\(updated\) \|\| isMarketingUserSyncCandidate\(user\)/);
assert.match(authSource, /isFieldServiceUserSyncCandidate\(updated\) \|\| isFieldServiceUserSyncCandidate\(user\)/);
assert.match(authSource, /Profile updated without user sync eligibility/);
// Delivery resolves the receiver path per target service.
const deliverySource = readFileSync(new URL('../src/modules/user-sync/user-sync.delivery.ts', import.meta.url), 'utf8');
assert.match(deliverySource, /'fieldservice\/internal\/users\/events'/);
assert.match(deliverySource, /USER_SYNC_PATHS\[job\.targetService as UserSyncTarget\]/);

// Retry backoff stays bounded for the delivery worker.
assert.equal(retryDelay(1), 10000);
assert.ok(retryDelay(20) <= 300000);

// ── Monitoring endpoint: GET /users/sync/deliveries (APP_MANAGER only) ─────
const { listUserSyncDeliveriesSchema } = await import('../dist/modules/user-management/user-management.schemas.js');
const { listUserSyncDeliveries } = await import('../dist/modules/user-sync/user-sync.service.js');

// Query validation: defaults, allowed filters and strict rejection of unknown keys.
const query = listUserSyncDeliveriesSchema.parse({});
assert.equal(query.page, 1);
assert.equal(query.limit, 20);
assert.equal(query.status, undefined);
const filtered = listUserSyncDeliveriesSchema.parse({
  page: '2', limit: '50', status: 'pending', targetService: 'fieldservice-service',
  userId: '00000000-0000-4000-8000-000000000001',
});
assert.equal(filtered.page, 2);
assert.equal(filtered.limit, 50);
assert.equal(filtered.status, 'pending');
assert.equal(filtered.targetService, 'fieldservice-service');
assert.throws(() => listUserSyncDeliveriesSchema.parse({ status: 'failed' }));
assert.throws(() => listUserSyncDeliveriesSchema.parse({ targetService: 'unknown-service' }));
assert.throws(() => listUserSyncDeliveriesSchema.parse({ limit: 101 }));
assert.throws(() => listUserSyncDeliveriesSchema.parse({ branchId: 'x' }));

// Read path: filters translate to the outbox where clause, pending rows are
// ordered first (deliveredAt DESC = NULLS FIRST on PostgreSQL) and every row
// exposes the derived status used by the monitoring response.
const now = Date.now();
const deliveredRow = {
  id: 'd1', eventId: 'e2', targetService: 'marketing-service', attempts: 1,
  nextRetryAt: new Date(now - 1000), deliveredAt: new Date(now - 500), lastError: null,
  event: { id: 'e2', userId: user.id, version: 2, createdAt: new Date(now - 2000) },
};
const pendingRow = {
  id: 'd2', eventId: 'e3', targetService: 'fieldservice-service', attempts: 3,
  nextRetryAt: new Date(now + 60000), deliveredAt: null, lastError: 'Receiver returned HTTP 503',
  event: { id: 'e3', userId: user.id, version: 3, createdAt: new Date(now - 1000) },
};
const seen = {};
const fakeStore = {
  userSyncDelivery: {
    findMany: async (args) => { seen.findMany = args; return [pendingRow, deliveredRow]; },
    count: async (where) => { seen.count = where; return 2; },
  },
};
const result = await listUserSyncDeliveries(
  { page: 1, limit: 20, status: 'pending', userId: user.id },
  fakeStore,
);
assert.deepEqual(seen.findMany.where, { deliveredAt: null, event: { userId: user.id } });
assert.deepEqual(seen.findMany.orderBy, [{ deliveredAt: 'desc' }, { nextRetryAt: 'asc' }, { id: 'asc' }]);
assert.equal(seen.findMany.take, 20);
assert.equal(seen.findMany.skip, 0);
assert.equal(result.deliveries[0].status, 'pending');
assert.equal(result.deliveries[1].status, 'delivered');
assert.equal(result.deliveries[0].lastError, 'Receiver returned HTTP 503');
assert.deepEqual(result.pagination, { page: 1, limit: 20, total: 2, totalPages: 1 });
// No status filter returns both states with an empty where clause.
await listUserSyncDeliveries({ page: 1, limit: 20 }, fakeStore);
assert.deepEqual(seen.count.where, {});

// Access guard: the route sits behind authenticate + requireAppManager, is
// declared before '/:userId', and the middleware only checks role APP_MANAGER
// (section and branch are not part of the contract).
const routesSource = readFileSync(new URL('../src/modules/user-management/user-management.routes.ts', import.meta.url), 'utf8');
const guardIndex = routesSource.indexOf('router.use(authenticate, asyncHandler(requireAppManager))');
const routeIndex = routesSource.indexOf("router.get('/sync/deliveries'");
assert.ok(guardIndex >= 0 && routeIndex > guardIndex, 'sync deliveries route must run behind the APP_MANAGER guard');
assert.ok(routeIndex < routesSource.indexOf("router.get('/:userId'"), 'sync deliveries route must precede the parameter route');
const middlewareSource = readFileSync(new URL('../src/modules/user-management/user-management.middleware.ts', import.meta.url), 'utf8');
assert.match(middlewareSource, /actor\.role !== UserRole\.APP_MANAGER/);
assert.ok(!middlewareSource.includes('section'), 'access must not depend on section');
assert.ok(!middlewareSource.includes('officeBranchId'), 'access must not depend on branch');
const controllerSource = readFileSync(new URL('../src/modules/user-management/user-management.controller.ts', import.meta.url), 'utf8');
assert.match(controllerSource, /await processDueUserSyncs\(\);/, 'monitoring must attempt due retries before reading');

console.log('PASS: user sync outbox enqueue payload, delivery target, retry backoff and APP_MANAGER-only monitoring query.');
