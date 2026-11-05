/**
 * CONCURRENCY - app-manager-service.
 *
 * Covers the invariants of the menu hierarchy and the office branch:
 *   - a single head office branch (advisory lock + partial unique index)
 *   - menu hierarchy integrity under concurrent writes (global write lock)
 *   - menu item key uniqueness
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GATEWAY, execute, loginAs, query, seedOfficeBranch, seedUser, type SeededUser } from './support/fixtures.js';
import { httpRequest } from './support/http.js';
import { Barrier } from './support/metrics.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let appManager: ServiceProcess;
let gateway: ServiceProcess;

let manager: SeededUser;
let branchId: string;

const APP_MANAGER = '/api/v1/app-manager';
const menuKey = (): string => `reltest_menu_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

describe('app-manager-service concurrency', () => {
  // Every test starts from an empty app-manager database, so the single-head
  // invariant is asserted against a known state.
  resetBeforeEach(['appManager']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    appManager = await startService('appManager');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, appManager, auth]) await process_?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    manager = await seedUser({ role: 'APP_MANAGER', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(manager);
  });

  test('SINGLE HEAD: concurrent head-branch creation leaves exactly one head', async () => {
    const body = (name: string) => ({
      name, address: 'RelTest address', telp: '0000', email: 'reltest@example.local', isHead: true,
    });

    const barrier = new Barrier(4);
    const names = ['Head A', 'Head B', 'Head C', 'Head D'].map((suffix) => `RELTEST-${suffix}-${randomUUID().slice(0, 6)}`);
    const responses = await Promise.all(names.map(async (name) => {
      await barrier.wait();
      return httpRequest(`${GATEWAY}${APP_MANAGER}/office-branches`, {
        method: 'POST',
        token: manager.accessToken,
        body: body(name),
      });
    }));

    const created = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);
    assert.equal(
      created.length,
      1,
      `exactly one head branch may be created, got ${created.length} `
      + `(statuses ${responses.map((response) => response.status).join(', ')}) `
      + `(body ${JSON.stringify(responses[0]?.body)})`,
    );
    assert.equal(conflicts.length, 3, `the others must be rejected with 409, got ${conflicts.map((r) => r.status).join(', ')}`);

    const rows = await query<{ count: number }>(
      'appManager',
      'SELECT count(*)::int AS count FROM office_branches WHERE is_head = true',
    );
    assert.equal(rows[0]?.count, 1, 'exactly one head branch may exist');
  });

  test('SINGLE HEAD: promoting a second branch to head is rejected with 409', async () => {
    const head = await seedOfficeBranch({ isHead: true });
    const other = await seedOfficeBranch();

    const response = await httpRequest(`${GATEWAY}${APP_MANAGER}/office-branches/${other.id}`, {
      method: 'PATCH',
      token: manager.accessToken,
      body: { isHead: true },
    });
    assert.equal(response.status, 409, JSON.stringify(response.body));

    const rows = await query<{ id: string }>(
      'appManager',
      'SELECT id FROM office_branches WHERE is_head = true',
    );
    assert.equal(rows.length, 1, 'the original head must remain the only head');
    assert.equal(rows[0].id, head.id);
  });

  test('SINGLE HEAD: the database index rejects a second head even without the service', async () => {
    // The service guards the invariant with an advisory lock. This test
    // bypasses the service on purpose and writes straight to the database, so
    // it proves the second line of defence: the partial unique index.
    const head = await seedOfficeBranch({ isHead: true });

    // PostgreSQL reports the violation as 23505 with the message
    // "Key (is_head)=(t) already exists."; the index name appears in the
    // constraint detail.
    await assert.rejects(
      () => execute(
        'appManager',
        `INSERT INTO office_branches (id, name, address, telp, email, is_head, created_at, updated_at)
         VALUES (gen_random_uuid(), 'RelTest bypass head', 'RelTest address', '0000',
                 'reltest-bypass@example.local', true, now(), now())`,
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error, 'the write must fail with an error');
        assert.match(error.message, /23505|already exists/i);
        return true;
      },
      'the database must reject a second head branch',
    );

    const rows = await query<{ count: number }>(
      'appManager',
      'SELECT count(*)::int AS count FROM office_branches WHERE is_head = true',
    );
    assert.equal(rows[0]?.count, 1, 'the original head must remain the only head');
    assert.ok(head.id, 'the seeded head must exist');
  });

  test('MENU HIERARCHY: concurrent menu creation with the same key creates one menu', async () => {
    const key = menuKey();
    const barrier = new Barrier(4);
    const responses = await Promise.all(Array.from({ length: 4 }, async () => {
      await barrier.wait();
      return httpRequest(`${GATEWAY}${APP_MANAGER}/menus`, {
        method: 'POST',
        token: manager.accessToken,
        body: { key, label: 'RelTest menu', hasItem: false },
      });
    }));

    const created = responses.filter((response) => response.status === 201);
    assert.equal(created.length, 1, `exactly one menu may be created, got ${created.length}`);

    const rows = await query<{ count: number }>(
      'appManager',
      'SELECT count(*)::int AS count FROM menus WHERE key = $1',
      key,
    );
    assert.equal(rows[0]?.count, 1, 'exactly one menu row may exist');
  });

  test('MENU HIERARCHY: concurrent item creation under one menu keeps every item exactly once', async () => {
    const key = menuKey();
    // A menu must allow items before an item may be attached to it.
    const menu = await httpRequest(`${GATEWAY}${APP_MANAGER}/menus`, {
      method: 'POST',
      token: manager.accessToken,
      body: {
        key,
        label: 'RelTest menu',
        hasItem: true,
        items: [{ key: `reltest_seed_${randomUUID().slice(0, 6)}`, label: 'RelTest seed item' }],
      },
    });
    assert.equal(menu.status, 201, JSON.stringify(menu.body));
    const menuId = (menu.body as { data: { id: string } }).data.id;

    const barrier = new Barrier(5);
    const responses = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
      await barrier.wait();
      return httpRequest(`${GATEWAY}${APP_MANAGER}/menu-items`, {
        method: 'POST',
        token: manager.accessToken,
        body: { menuId, key: `reltest_item_${index}_${randomUUID().slice(0, 6)}`, label: `RelTest item ${index}` },
      });
    }));

    const created = responses.filter((response) => response.status === 201);
    assert.equal(
      created.length,
      5,
      `every distinct item key must be created, got ${created.length} `
      + `(statuses ${responses.map((response) => response.status).join(', ')}) `
      + `(body ${JSON.stringify(responses[0]?.body)})`,
    );

    const rows = await query<{ count: number }>(
      'appManager',
      'SELECT count(*)::int AS count FROM menu_items WHERE menu_id = $1::uuid',
      menuId,
    );
    // One seed item from the menu creation plus the five concurrent items.
    assert.equal(rows[0]?.count, 6, 'every item must be stored exactly once');
  });
});
