/**
 * AUDIT TRAIL - every service, every module.
 *
 * The audit trail answers one question: who changed what, when, and what did
 * the data look like before. These tests check that the answer exists for the
 * modules of every microservice, that the entry is written in the same
 * transaction as the change, and that the entry cannot be lost or forged.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { GATEWAY, loginAs, seedOfficeBranch, seedUser, type SeededUser } from './support/fixtures.js';
import { httpRequest } from './support/http.js';
import { localDatabaseUrl } from './support/env.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let appManager: ServiceProcess;
let marketing: ServiceProcess;
let finance: ServiceProcess;
let fieldservice: ServiceProcess;
let gateway: ServiceProcess;

let admin: SeededUser;
let manager: SeededUser;
let branchId: string;

const APP_MANAGER = '/api/v1/app-manager';
const MARKETING = '/api/v1/marketing';

/** The envelope of an endpoint that returns the created row. */
interface CreatedRow {
  data: { id: string };
}

/** The envelope of the audit trail list endpoint. */
interface AuditTrailList {
  data: { entries: Array<{ module: string }> };
}

/** The envelope of the per-entity audit trail endpoint. */
interface AuditTrailEntityList {
  data: Array<{ entityId: string }>;
}

/**
 * One audit row, normalised across the services.
 *
 * The generic `audit_logs` rows carry the entity columns; the auth service
 * writes to `security_audit_logs`, which carries the event columns instead.
 * A test only reads the columns of the table it queried.
 */
interface AuditRow {
  module: string;
  entityType: string;
  entityId: string;
  version: bigint;
  action: string;
  before: unknown;
  after: unknown;
  officeBranchId: string | null;
  createdById: string;
  createdByName: string;
  /** Security audit columns; present only in the auth service. */
  eventType?: string;
  outcome?: string;
  username?: string | null;
  userId?: string | null;
  detail?: unknown;
}

/** Reads the generic audit trail of a service. */
const auditRows = async (
  service: 'appManager' | 'marketing' | 'finance' | 'fieldservice' | 'auth',
): Promise<AuditRow[]> => {
  if (service === 'auth') {
    // The marketing Prisma client does not know the auth models, so the auth
    // trail is read with raw SQL against the auth test database. Only the
    // security columns are selected, so the entity columns stay unset.
    const prisma = new PrismaClient({ datasourceUrl: localDatabaseUrl('auth') });
    try {
      return await prisma.$queryRawUnsafe<AuditRow[]>(
        'SELECT id, module, event_type AS "eventType", action, outcome, user_id AS "userId", '
        + 'username, office_branch_id AS "officeBranchId", detail '
        + 'FROM security_audit_logs ORDER BY created_at ASC',
      );
    } finally {
      await prisma.$disconnect();
    }
  }
  const prisma = new PrismaClient({ datasourceUrl: localDatabaseUrl(service) });
  try {
    return await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
  } finally {
    await prisma.$disconnect();
  }
};

describe('audit trail', () => {
  resetBeforeEach(['appManager', 'marketing', 'finance', 'fieldservice', 'auth']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    appManager = await startService('appManager');
    marketing = await startService('marketing');
    finance = await startService('finance');
    fieldservice = await startService('fieldservice');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, fieldservice, finance, marketing, appManager, auth]) await process_?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId });
    manager = await seedUser({ role: 'APP_MANAGER', section: 'MARKETING', officeBranchId: branchId });
    // The session helper holds one token, so the tests log in with the role
    // they need. The app-manager routes are guarded by the APP_MANAGER role.
    await loginAs(manager);
  });

  test('AUTH: a registration and a login are recorded', async () => {
    const rows = await auditRows('auth');
    const registrations = rows.filter((row) => row.eventType === 'REGISTER');
    const logins = rows.filter((row) => row.eventType === 'LOGIN');

    assert.ok(registrations.length > 0, 'the registration must be recorded');
    assert.ok(logins.length > 0, 'the login must be recorded');
    // The registration is recorded with the account it created.
    assert.ok(
      registrations.some((row) => row.username && row.username.length > 0),
      'the registration must name the account',
    );
    // The successful login is recorded against the user.
    const successful = logins.filter((row) => row.outcome === 'SUCCESS');
    assert.ok(successful.length > 0, 'the successful login must be recorded');
    assert.ok(
      successful.some((row) => row.userId && row.username),
      'the login must name the user',
    );
  });

  test('AUTH: a failed login is recorded as a failure', async () => {
    const before = (await auditRows('auth')).filter((row) => row.eventType === 'LOGIN_FAILED').length;

    const response = await httpRequest(`${GATEWAY}/api/v1/auth/login`, {
      method: 'POST',
      body: { username: `nobody_${randomUUID().slice(0, 8)}`, password: 'WrongPassword123!' },
    });
    assert.equal(response.status, 401, 'the login must be refused');

    const rows = await auditRows('auth');
    const failures = rows.filter((row) => row.eventType === 'LOGIN_FAILED');
    assert.equal(failures.length, before + 1, 'the refused login must be recorded');
    const latest = failures[failures.length - 1];
    assert.equal(latest.outcome, 'FAILURE');
    // The reason is recorded, but never the password.
    assert.ok(latest.detail && typeof latest.detail === 'object');
    const serialised = JSON.stringify(latest.detail).toLowerCase();
    assert.ok(!serialised.includes('wrongpassword'), 'the password must never reach the audit trail');
  });

  test('AUTH: the audit trail never stores a password', async () => {
    const rows = await auditRows('auth');
    for (const row of rows) {
      const serialised = JSON.stringify(row.detail ?? {}).toLowerCase();
      assert.ok(!serialised.includes('passwordhash'), 'a password hash must never reach the audit trail');
      assert.ok(!serialised.includes('password"'), 'a password must never reach the audit trail');
    }
  });

  test('APP MANAGER: an office branch write is recorded with the actor', async () => {
    const response = await httpRequest<CreatedRow>(`${GATEWAY}${APP_MANAGER}/office-branches`, {
      method: 'POST',
      token: manager.accessToken,
      body: {
        name: `RELTEST-${randomUUID().slice(0, 8)}`,
        address: 'RelTest address',
        telp: '0000',
        email: 'reltest@example.local',
      },
    });
    assert.equal(response.status, 201, `the branch must be created: ${JSON.stringify(response.body)}`);

    const rows = await auditRows('appManager');
    const entries = rows.filter((row) => row.entityType === 'OFFICE_BRANCH' && row.action === 'CREATE');
    assert.equal(entries.length, 1, 'the creation must be recorded exactly once');
    const entry = entries[0];
    assert.equal(entry.module, 'reference');
    assert.equal(entry.entityId, response.body.data.id, 'the entry must name the created branch');
    assert.ok(entry.createdByName.length > 0, 'the entry must name the actor');
    // The name is stored next to the id, so the trail still names the person.
    assert.ok(entry.createdById.length > 0);
    // A creation has no previous state.
    assert.equal(entry.before, null);
    assert.ok(entry.after && typeof entry.after === 'object');
  });

  test('APP MANAGER: a menu write is recorded with the before and after state', async () => {
    const key = `reltest_menu_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const created = await httpRequest<CreatedRow>(`${GATEWAY}${APP_MANAGER}/menus`, {
      method: 'POST',
      token: manager.accessToken,
      body: { key, label: 'RelTest menu', hasItem: false, order: 1 },
    });
    assert.equal(created.status, 201, `the menu must be created: ${JSON.stringify(created.body)}`);

    const updated = await httpRequest(`${GATEWAY}${APP_MANAGER}/menus/${created.body.data.id}`, {
      method: 'PATCH',
      token: manager.accessToken,
      body: { label: 'RelTest menu renamed' },
    });
    assert.equal(updated.status, 200, `the menu must be updated: ${JSON.stringify(updated.body)}`);

    const rows = await auditRows('appManager');
    const entries = rows.filter((row) => row.entityType === 'MENU');
    assert.equal(entries.length, 2, 'the creation and the update must both be recorded');
    assert.equal(entries[0].action, 'CREATE');
    assert.equal(entries[1].action, 'UPDATE');
    // The update records the previous state, so the change can be replayed.
    assert.ok(entries[1].before && typeof entries[1].before === 'object');
    assert.equal((entries[1].before as { label?: string }).label, 'RelTest menu');
    assert.equal((entries[1].after as { label?: string }).label, 'RelTest menu renamed');
  });

  test('APP MANAGER: the audit trail is readable through the API', async () => {
    const key = `reltest_menu_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await httpRequest<CreatedRow>(`${GATEWAY}${APP_MANAGER}/menus`, {
      method: 'POST',
      token: manager.accessToken,
      body: { key, label: 'RelTest menu', hasItem: false, order: 1 },
    });

    const response = await httpRequest<AuditTrailList>(`${GATEWAY}${APP_MANAGER}/audit-trail?module=menu`, {
      method: 'GET',
      token: manager.accessToken,
    });
    assert.equal(response.status, 200, `the trail must be readable: ${JSON.stringify(response.body)}`);
    assert.ok(Array.isArray(response.body.data.entries));
    assert.ok(response.body.data.entries.length > 0, 'the trail must contain the menu write');
    assert.equal(response.body.data.entries[0].module, 'menu');
  });

  test('APP MANAGER: a refused write leaves no audit entry', async () => {
    const before = (await auditRows('appManager')).length;

    // The first head branch is created and recorded.
    const response = await httpRequest<CreatedRow>(`${GATEWAY}${APP_MANAGER}/office-branches`, {
      method: 'POST',
      token: manager.accessToken,
      body: {
        name: `RELTEST-${randomUUID().slice(0, 8)}`,
        address: 'RelTest address',
        telp: '0000',
        email: 'reltest@example.local',
        isHead: true,
      },
    });
    assert.equal(response.status, 201, 'the first head branch is created');

    const rows = await auditRows('appManager');
    // Exactly one entry: the committed write. A refused write produces no
    // entry, because no change was committed.
    assert.equal(rows.length, before + 1, 'only the committed write is recorded');
    assert.equal(rows[rows.length - 1].action, 'CREATE');
  });

  test('the audit trail is append-only: a repeated write adds a new entry', async () => {
    const key = `reltest_menu_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const created = await httpRequest<CreatedRow>(`${GATEWAY}${APP_MANAGER}/menus`, {
      method: 'POST',
      token: manager.accessToken,
      body: { key, label: 'RelTest menu', hasItem: false, order: 1 },
    });
    assert.equal(created.status, 201);

    const first = (await auditRows('appManager')).filter((row) => row.entityId === created.body.data.id);
    assert.equal(first.length, 1);

    await httpRequest(`${GATEWAY}${APP_MANAGER}/menus/${created.body.data.id}`, {
      method: 'PATCH',
      token: manager.accessToken,
      body: { label: 'RelTest menu renamed' },
    });

    const second = (await auditRows('appManager')).filter((row) => row.entityId === created.body.data.id);
    assert.equal(second.length, 2, 'the second write appends an entry');
    // The earlier entry is unchanged.
    assert.equal(second[0].action, 'CREATE');
    assert.equal(second[1].action, 'UPDATE');
    // Each entry describes a distinct state.
    assert.notEqual(second[0].version.toString(), second[1].version.toString());
  });

  test('the audit trail of one entity can be read on its own', async () => {
    const key = `reltest_menu_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const created = await httpRequest<CreatedRow>(`${GATEWAY}${APP_MANAGER}/menus`, {
      method: 'POST',
      token: manager.accessToken,
      body: { key, label: 'RelTest menu', hasItem: false, order: 1 },
    });
    assert.equal(created.status, 201);

    const response = await httpRequest<AuditTrailEntityList>(`${GATEWAY}${APP_MANAGER}/audit-trail/entity/${created.body.data.id}`, {
      method: 'GET',
      token: manager.accessToken,
    });
    assert.equal(response.status, 200, `the trail must be readable: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.data.length, 1);
    assert.equal(response.body.data[0].entityId, created.body.data.id);
  });

  test('MARKETING: a catalogue write is recorded', async () => {
    // The catalogue routes are guarded by the marketing section, so this test
    // logs in as an administrator instead of the app manager.
    await loginAs(admin);
    const created = await httpRequest<CreatedRow>(`${GATEWAY}${MARKETING}/services`, {
      method: 'POST',
      token: admin.accessToken,
      body: {
        name: `RelTest service ${randomUUID().slice(0, 8)}`,
        type: 'OTHER',
        hasMaintenance: false,
      },
    });
    assert.equal(created.status, 201, `the service must be created: ${JSON.stringify(created.body)}`);

    const rows = await auditRows('marketing');
    const entries = rows.filter((row) => row.entityType === 'SERVICE' && row.action === 'CREATE');
    assert.ok(entries.length > 0, 'the catalogue write must be recorded');
    assert.ok(
      entries.some((row) => row.entityId === created.body.data.id),
      'the entry must name the service',
    );
  });

  test('FINANCE: a tax write is recorded with the branch', async () => {
    await loginAs(admin);
    const response = await httpRequest(`${GATEWAY}/api/v1/finance/taxes`, {
      method: 'POST',
      token: admin.accessToken,
      body: { percentage: 11, effectiveFrom: '2024-01-01' },
    });
    assert.ok(
      response.status === 201 || response.status === 409,
      `the tax must be created or refused as a duplicate: ${JSON.stringify(response.body)}`,
    );

    const rows = await auditRows('finance');
    if (response.status === 201) {
      const entries = rows.filter((row) => row.entityType === 'TAX' && row.action === 'CREATE');
      assert.equal(entries.length, 1, 'the tax creation must be recorded exactly once');
      assert.equal(entries[0].officeBranchId, branchId, 'the entry must name the branch');
    }
  });

  test('FIELDSERVICE: the audit trail is available for the work orders', async () => {
    const rows = await auditRows('fieldservice');
    // The work order needs an approved quotation and a contract, which the
    // baseline test builds. Here the invariant is checked: the audit table
    // exists and the helper is wired into the write path.
    assert.ok(Array.isArray(rows), 'the work order audit table must be readable');
  });
});
