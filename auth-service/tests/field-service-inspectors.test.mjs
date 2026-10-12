import assert from 'node:assert/strict';
import { inspectUsersQuerySchema } from '../dist/modules/user-management/user-management.schemas.js';
import { userManagementService } from '../dist/modules/user-management/user-management.service.js';

// ── GET /users/field-service/inspectors: query contract ──────────────────────
// Comma-separated IDs are split, validated as UUIDs, capped at 100 and unique.
const ids = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'];
assert.deepEqual(inspectUsersQuerySchema.parse({ ids: ids.join(',') }).ids, ids);
assert.deepEqual(inspectUsersQuerySchema.parse({ ids: ' 00000000-0000-4000-8000-0000000000a1 ' }).ids, [ids[0]]);
for (const invalid of [
  {},
  { ids: '' },
  { ids: 'not-a-uuid' },
  { ids: `${ids[0]},${ids[0]}` },
  { ids: Array.from({ length: 101 }, () => '00000000-0000-4000-8000-000000000001').join(',') },
  { ids: ids.join(','), extra: 'x' },
]) assert.equal(inspectUsersQuerySchema.safeParse(invalid).success, false, JSON.stringify(invalid));

// ── Service: branch-scoped eligibility filtering and display-name snapshot ───
// Auth is the source of truth: only active FIELD_SERVICE users of the caller
// branch are returned, so Field Service can detect drift before starting.
const branch = '00000000-0000-4000-8000-00000000000b';
const seen = { findMany: null };
const store = {
  user: {
    findUnique: async ({ where }) => ({ officeBranchId: where.id === '00000000-0000-4000-8000-000000000001' ? branch : null }),
    findMany: async (args) => {
      seen.findMany = args;
      // Mirrors the repository: ineligible IDs are silently omitted.
      return args.where.id.in
        .filter(id => id === ids[0])
        .map(id => ({ id, firstName: 'Budi', lastName: 'Tester' }));
    },
  },
};
const result = await userManagementService.inspectors('00000000-0000-4000-8000-000000000001', ids, store);
assert.deepEqual(result, { inspectors: [{ id: ids[0], name: 'Budi Tester' }] });
assert.equal(seen.findMany.where.officeBranchId, branch, 'branch always comes from the authenticated caller');
assert.equal(seen.findMany.where.section, 'FIELD_SERVICE');
assert.equal(seen.findMany.where.isActive, true);
assert.deepEqual(seen.findMany.where.id.in, ids, 'the submitted ID list is forwarded unchanged');

// A caller without a branch gets an empty result without touching the users table.
seen.findMany = null;
assert.deepEqual(
  await userManagementService.inspectors('00000000-0000-4000-8000-000000000002', ids, store),
  { inspectors: [] },
);
assert.equal(seen.findMany, null, 'branchless callers never query users');

// Empty display name is possible when first/last names are blank.
store.user.findMany = async () => [{ id: ids[0], firstName: '  ', lastName: '' }];
assert.deepEqual(
  await userManagementService.inspectors('00000000-0000-4000-8000-000000000001', [ids[0]], store),
  { inspectors: [{ id: ids[0], name: '' }] },
);

console.log('PASS: field-service inspector query contract, branch scoping, eligibility filter and display-name mapping.');
