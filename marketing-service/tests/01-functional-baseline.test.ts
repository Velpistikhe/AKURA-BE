/**
 * FUNCTIONAL BASELINE - marketing-service.
 *
 * Verifies the normal create/read/update/delete path, authorization,
 * validation, response envelope and transaction rollback before any
 * concurrency or stress testing is attempted.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY, loginAs, prismaFor, seedMarketingTax, seedOfficeBranch, seedUser,
  type SeededUser,
} from './support/fixtures.js';
import { httpRequest, syntheticName } from './support/http.js';
import { TEST_PORTS } from './support/env.js';
import { ensureDatabases } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';
import { assertEnvelope } from './support/suite.js';

let auth: ServiceProcess;
let marketing: ServiceProcess;
let gateway: ServiceProcess;

let admin: SeededUser;
let branchId: string;

const COMPANIES = '/api/v1/marketing/companies';

const createCompany = async (name: string, token = admin.accessToken) => {
  const response = await httpRequest(`${GATEWAY}${COMPANIES}`, {
    method: 'POST',
    token,
    body: { name, type: 'PT', address: 'RelTest address', npwp: '00.000.000.0-000.000', isSisterCompany: false },
  });
  return response;
};

describe('marketing-service functional baseline', () => {
  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    marketing = await startService('marketing');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, marketing, auth]) await process_?.stop();
  });

  before(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    await seedMarketingTax(branchId);
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(admin);
  });

  test('CREATE: creates a company and returns the Akura envelope', async () => {
    const name = syntheticName('COMPANY');
    const response = await createCompany(name);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assertEnvelope(response.body, 201);
    const data = (response.body as { data: { id: string; name: string; version: number } }).data;
    assert.equal(data.name, name);
    assert.equal(data.version, 0);
  });

  test('READ: lists and fetches the created company', async () => {
    const created = await createCompany(syntheticName('COMPANY'));
    assert.equal(created.status, 201);
    const id = (created.body as { data: { id: string } }).data.id;

    const list = await httpRequest(`${GATEWAY}${COMPANIES}`, { token: admin.accessToken });
    assert.equal(list.status, 200);
    assertEnvelope(list.body, 200);
    const listData = (list.body as { data: { companies: Array<{ id: string }> } }).data;
    assert.ok(listData.companies.some((company) => company.id === id), 'created company must appear in the list');

    const single = await httpRequest(`${GATEWAY}${COMPANIES}/${id}`, { token: admin.accessToken });
    assert.equal(single.status, 200);
    assert.equal((single.body as { data: { id: string } }).data.id, id);
  });

  test('UPDATE: applies a change and bumps the version', async () => {
    const created = await createCompany(syntheticName('COMPANY'));
    const createdData = (created.body as { data: { id: string; version: number } }).data;
    const updatedName = syntheticName('COMPANY');

    const updated = await httpRequest(`${GATEWAY}${COMPANIES}/${createdData.id}`, {
      method: 'PATCH',
      token: admin.accessToken,
      body: { version: createdData.version, name: updatedName },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    const updatedData = (updated.body as { data: { name: string; version: number } }).data;
    assert.equal(updatedData.name, updatedName);
    assert.equal(updatedData.version, createdData.version + 1);
  });

  test('DELETE: soft-deletes a company staff member so it disappears from the list', async () => {
    const companyResponse = await createCompany(syntheticName('COMPANY'));
    const companyId = (companyResponse.body as { data: { id: string } }).data.id;
    const staff = await httpRequest(`${GATEWAY}/api/v1/marketing/company-staffs`, {
      method: 'POST',
      token: admin.accessToken,
      body: {
        companyId, name: 'Rel Test Staff', title: 'mr', telp: '0000', email: 'staff@reltest.local',
      },
    });
    assert.equal(staff.status, 201, JSON.stringify(staff.body));
    const staffData = (staff.body as { data: { id: string; version: number } }).data;

    const deleted = await httpRequest(`${GATEWAY}/api/v1/marketing/company-staffs/${staffData.id}`, {
      method: 'DELETE',
      token: admin.accessToken,
      body: { version: staffData.version },
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));

    const list = await httpRequest(`${GATEWAY}/api/v1/marketing/company-staffs?companyId=${companyId}`, {
      token: admin.accessToken,
    });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const listData = (list.body as { data: { staffs: Array<{ id: string }> } }).data;
    assert.ok(
      !listData.staffs.some((row) => row.id === staffData.id),
      'a deactivated staff member must not be listed',
    );
  });

  test('AUTHORIZATION: a request that bypasses the gateway is rejected with 403', async () => {
    // The service is reachable only through the API Gateway. A direct call -
    // even with a valid access token - carries no gateway secret and must be
    // refused, in development as well as in production.
    const direct = await httpRequest(`http://127.0.0.1:${TEST_PORTS.marketing}${COMPANIES}`, {
      token: admin.accessToken,
    });
    assert.equal(direct.status, 403, JSON.stringify(direct.body));
    assert.match(
      (direct.body as { message: string }).message,
      /must pass through the API Gateway/,
      'a direct request must be told to go through the gateway',
    );
  });

  test('AUTHORIZATION: a request without a token is rejected with 401', async () => {
    const response = await httpRequest(`${GATEWAY}${COMPANIES}`);
    assert.equal(response.status, 401);
    assertEnvelope(response.body, 401);
  });

  test('AUTHORIZATION: a request with a forged bearer token is rejected with 401', async () => {
    const response = await httpRequest(`${GATEWAY}${COMPANIES}`, { token: 'not-a-real-token' });
    assert.equal(response.status, 401);
  });

  test('VALIDATION: a company without a name is rejected with 400', async () => {
    const response = await httpRequest(`${GATEWAY}${COMPANIES}`, {
      method: 'POST',
      token: admin.accessToken,
      body: { type: 'PT', address: 'RelTest address', npwp: '00.000.000.0-000.000' },
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  test('VALIDATION: an unknown field is rejected with 400', async () => {
    const response = await httpRequest(`${GATEWAY}${COMPANIES}`, {
      method: 'POST',
      token: admin.accessToken,
      body: {
        name: syntheticName('COMPANY'), type: 'PT', address: 'RelTest address',
        npwp: '00.000.000.0-000.000', unexpectedField: 'x',
      },
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
  });

  test('TRANSACTION ROLLBACK: a rejected create leaves no company and no history row', async () => {
    const prisma = prismaFor('marketing');
    try {
      const name = syntheticName('COMPANY');
      const first = await createCompany(name);
      assert.equal(first.status, 201);
      const createdId = (first.body as { data: { id: string } }).data.id;

      // A duplicate normalized name inside the same branch violates the unique
      // constraint, so the whole transaction must roll back.
      const duplicate = await createCompany(name);
      assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));

      // Scope the assertion to this company: the rejected create must not have
      // produced a second company row nor a second history row.
      const companies = await prisma.company.count({ where: { officeBranchId: branchId, normalizeName: name.toLowerCase() } });
      assert.equal(companies, 1, 'the rejected create must not persist a second company');

      const history = await prisma.companyHistory.count({ where: { companyId: createdId } });
      assert.equal(history, 1, 'a rejected create must not leave a history row');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('TENANCY: a company of another branch is not visible', async () => {
    const otherBranch = await seedOfficeBranch();
    await seedMarketingTax(otherBranch.id);
    const otherAdmin = await seedUser({
      role: 'ADMIN', section: 'MARKETING', officeBranchId: otherBranch.id,
    });
    await loginAs(otherAdmin);

    const created = await createCompany(syntheticName('COMPANY'), otherAdmin.accessToken);
    assert.equal(created.status, 201);
    const id = (created.body as { data: { id: string } }).data.id;

    const list = await httpRequest(`${GATEWAY}${COMPANIES}`, { token: admin.accessToken });
    const listData = (list.body as { data: { companies: Array<{ id: string }> } }).data;
    assert.ok(!listData.companies.some((company) => company.id === id), 'a company must not cross branches');

    // Reading it directly must also be refused, not merely hidden from the list.
    const direct = await httpRequest(`${GATEWAY}${COMPANIES}/${id}`, { token: admin.accessToken });
    assert.equal(direct.status, 404, JSON.stringify(direct.body));
  });

  test('SECTION AUTHORIZATION: a user from another section is rejected with 403', async () => {
    const financeUser = await seedUser({
      role: 'USER', section: 'FINANCE', officeBranchId: branchId,
    });
    await loginAs(financeUser);
    const response = await httpRequest(`${GATEWAY}${COMPANIES}`, { token: financeUser.accessToken });
    assert.equal(response.status, 403, JSON.stringify(response.body));
  });

  test('INACTIVE ACCOUNT: a deactivated user is rejected with 403', async () => {
    const inactive = await seedUser({
      role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId,
    });
    await loginAs(inactive);
    // The auth service owns the users table; the deactivation is written with
    // raw SQL against the auth test database.
    const auth = prismaFor('auth');
    try {
      await auth.$executeRawUnsafe('UPDATE users SET is_active = false WHERE id = $1::uuid', inactive.id);
      const response = await httpRequest(`${GATEWAY}${COMPANIES}`, { token: inactive.accessToken });
      assert.equal(response.status, 403, JSON.stringify(response.body));
    } finally {
      await auth.$disconnect();
    }
  });
});
