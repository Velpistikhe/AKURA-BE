/**
 * Harness smoke test: proves the local stack boots and that a synthetic user
 * can register and log in through the gateway.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAY, seedOfficeBranch, seedUser, loginAs, seedMarketingTax } from './support/fixtures.js';
import { buildCatalogFixture, createQuotation, submitQuotation } from './support/catalog.js';
import { startS3Stub, s3Environment, type S3Stub } from './support/s3-stub.js';
import { httpRequest } from './support/http.js';
import { ensureDatabases } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let marketing: ServiceProcess;
let gateway: ServiceProcess;
let s3: S3Stub;

before(async () => {
  await ensureDatabases();
  s3 = await startS3Stub();
  auth = await startService('auth');
  marketing = await startService('marketing', s3Environment(s3));
  gateway = await startGateway();
});

after(async () => {
  for (const process_ of [gateway, marketing, auth]) await process_?.stop();
  await s3?.stop();
});

test('the local stack serves the gateway health endpoint', async () => {
  const response = await httpRequest(`${GATEWAY}/health`);
  assert.equal(response.status, 200);
});

test('a synthetic user can register, be promoted and log in', async () => {
  const branch = await seedOfficeBranch();
  const user = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branch.id });
  const token = await loginAs(user);
  assert.ok(token.length > 20, 'login must return an access token');

  const profile = await httpRequest(`${GATEWAY}/api/v1/auth/me`, { token });
  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  assert.equal((profile.body as { data: { id: string } }).data.id, user.id);
});

test('the marketing catalog chain can be built through the API', async () => {
  const branch = await seedOfficeBranch();
  await seedMarketingTax(branch.id);
  const user = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branch.id });
  const token = await loginAs(user);

  const fixture = await buildCatalogFixture(token);
  assert.ok(fixture.companyId);
  assert.ok(fixture.staffId);
  assert.ok(fixture.itemSizeId);

  const quotation = await createQuotation(token, fixture);
  assert.ok(quotation.id);
});

test('a quotation can be submitted and approved when S3 storage is available', async () => {
  const branch = await seedOfficeBranch();
  await seedMarketingTax(branch.id);
  const user = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branch.id });
  const token = await loginAs(user);
  const fixture = await buildCatalogFixture(token);
  const quotation = await createQuotation(token, fixture);

  const submitted = await submitQuotation(token, quotation.id, quotation.version);
  assert.equal(typeof submitted, 'number');

  const approved = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${quotation.id}/approve`, {
    method: 'POST',
    token,
    body: { version: submitted },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const data = (approved.body as { data: { no: number; numberYear: number } }).data;
  assert.equal(typeof data.no, 'number');
  assert.ok(data.no > 0, 'an approved quotation must receive a number');
});
