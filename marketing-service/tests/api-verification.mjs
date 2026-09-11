import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PrismaClient as MarketingPrismaClient } from '@prisma/client';

const requireFromAuth = createRequire(new URL('../../auth-service/package.json', import.meta.url));
const { PrismaClient: AuthPrismaClient } = requireFromAuth('@prisma/client');
const gatewayUrl = process.env.TEST_GATEWAY_URL || 'http://localhost:5000';
const stressTotal = Number.parseInt(process.env.TEST_STRESS_TOTAL || '25', 10);
const stressConcurrency = Number.parseInt(process.env.TEST_STRESS_CONCURRENCY || '5', 10);
const runId = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
const username = `marketing_${runId}`.slice(0, 50);
const password = 'MarketingTest-123!';
const officeBranchId = randomUUID();
const foreignOfficeBranchId = randomUUID();
const companyName = `Test Company ${runId}`;
const updatedCompanyName = `Updated Test Company ${runId}`;
const companyNormalizeNames = [companyName, updatedCompanyName].map((name) => name.toLowerCase().replace(/\s+/g, ''));
const checks = [];
let companyId;
let companyStaffId;
let serviceId;
let itemId;
let foreignCompanyId;
let foreignServiceId;

const readEnv = (path) => Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/)
  .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  .map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')]; }));
const authEnv = readEnv(new URL('../../auth-service/.env', import.meta.url));
const marketingPrisma = new MarketingPrismaClient();
const authPrisma = new AuthPrismaClient({ datasources: { db: { url: authEnv.DATABASE_URL } } });

const request = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (options.cookies) headers.cookie = options.cookies;
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${gatewayUrl}${path}`, {
    method: options.method || 'GET', headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  const cookies = (typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean))
    .map((value) => value.split(';', 1)[0]).join('; ');
  return { status: response.status, body, cookies };
};
const check = (name, result, expected, predicate = () => true) => {
  const passed = expected.includes(result.status) && predicate(result.body);
  checks.push({ name, status: result.status, passed, message: result.body?.message });
  if (!passed) throw new Error(`${name}: expected ${expected.join('/')} but received ${result.status}`);
  return result;
};

const summarizeStatuses = (results) => results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] || 0) + 1;
  return summary;
}, {});

const runLoad = async (name, total, concurrency, operation) => {
  let cursor = 0;
  const results = [];
  const startedAt = Date.now();
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < total) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(index);
    }
  });
  await Promise.all(workers);
  const durationMs = Date.now() - startedAt;
  check(name, {
    status: results.every((result) => result.status === 200) ? 200 : 500,
    body: { total, concurrency, durationMs, statuses: summarizeStatuses(results) },
  }, [200]);
};

try {
  check('Gateway rejects missing token', await request('/api/v1/marketing/companies'), [401]);
  check('OpenAPI exposes marketing endpoints', await request('/api-docs.json'), [200], (body) => [
    '/api/v1/marketing/companies', '/api/v1/marketing/companies/{companyId}',
    '/api/v1/marketing/company-staffs', '/api/v1/marketing/company-staffs/{companyStaffId}',
    '/api/v1/marketing/services', '/api/v1/marketing/services/{serviceId}',
    '/api/v1/marketing/services/{serviceId}/scopes', '/api/v1/marketing/services/{serviceId}/scopes/{scopeId}',
    '/api/v1/marketing/services/{serviceId}/maintenance/scopes',
    '/api/v1/marketing/services/{serviceId}/maintenance/scopes/{scopeId}',
    '/api/v1/marketing/items', '/api/v1/marketing/items/{itemId}',
    '/api/v1/marketing/items/sizes', '/api/v1/marketing/items/sizes/{itemSizeId}',
  ].every((path) => body?.paths?.[path]));

  check('Register test user', await request('/api/v1/auth/register', {
    method: 'POST', json: { username, password, passwordConfirmation: password, firstName: 'Marketing', lastName: 'API Test' },
  }), [201]);
  await authPrisma.user.update({
    where: { normalizeUsername: username.toLowerCase() },
    data: { section: 'MARKETING', officeBranchId, version: { increment: 1 } },
  });
  const login = check('Login marketing user', await request('/api/v1/auth/login', { method: 'POST', json: { username, password } }), [200]);
  const accessToken = login.cookies.split('; ').find((cookie) => cookie.startsWith('accessToken='))?.slice('accessToken='.length);
  const tokenPayload = accessToken ? JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) : undefined;
  if (tokenPayload?.officeBranchId !== officeBranchId) throw new Error('Access token does not contain the assigned officeBranchId');

  const foreignCompany = await marketingPrisma.company.create({
    data: {
      officeBranchId: foreignOfficeBranchId,
      name: `Foreign Company ${runId}`,
      normalizeName: `foreigncompany${runId}`,
      type: 'PT', npwp: '0012345678901234',
      address: 'Surabaya',
    },
  });
  foreignCompanyId = foreignCompany.id;
  const foreignService = await marketingPrisma.service.create({
    data: { officeBranchId: foreignOfficeBranchId, name: `Foreign Service ${runId}`, type: 'OCTG' },
  });
  foreignServiceId = foreignService.id;
  const foreignItem = await marketingPrisma.item.create({
    data: {
      officeBranchId: foreignOfficeBranchId,
      serviceId: foreignService.id,
      name: `Foreign Item ${runId}`,
      createdById: tokenPayload.sub,
      createdByName: 'Marketing API Test',
    },
  });
  check('Company from another branch is hidden', await request(`/api/v1/marketing/companies/${foreignCompany.id}`, {
    cookies: login.cookies,
  }), [404]);
  check('Service from another branch is hidden', await request(`/api/v1/marketing/services/${foreignService.id}`, {
    cookies: login.cookies,
  }), [404]);
  check('Item from another branch is hidden', await request(`/api/v1/marketing/items/${foreignItem.id}`, {
    cookies: login.cookies,
  }), [404]);

  const company = check('POST companies', await request('/api/v1/marketing/companies', {
    method: 'POST', cookies: login.cookies,
    json: { name: companyName, type: 'PT', npwp: '0012345678901234', address: 'Jakarta', isSisterCompany: false },
  }), [201], (body) => body?.data?.normalizeName === companyNormalizeNames[0]
    && body?.data?.officeBranchId === officeBranchId && body?.data?.version === 0);
  companyId = company.body.data.id;
  const raceCompanyName = `Race Company ${runId}`;
  companyNormalizeNames.push(raceCompanyName.toLowerCase().replace(/\s+/g, ''));
  const companyRace = await Promise.all(Array.from({ length: 6 }, () => request('/api/v1/marketing/companies', {
    method: 'POST', cookies: login.cookies,
    json: { name: raceCompanyName, type: 'CV', address: 'Jakarta' },
  })));
  const companyRaceStatuses = summarizeStatuses(companyRace);
  check('Concurrent company create preserves unique active normalized name', {
    status: companyRaceStatuses[201] === 1 && companyRaceStatuses[409] === 5 ? 200 : 500,
    body: companyRaceStatuses,
  }, [200]);
  check('POST duplicate normalized company', await request('/api/v1/marketing/companies', {
    method: 'POST', cookies: login.cookies,
    json: { name: companyName.toUpperCase().replaceAll(' ', '   '), type: 'PT', npwp: '0012345678901234', address: 'Bandung' },
  }), [409]);
  check('GET companies', await request(`/api/v1/marketing/companies?search=${encodeURIComponent(companyName)}`, { cookies: login.cookies }), [200], (body) => body?.data?.companies?.some((item) => item.id === companyId));
  check('GET company detail', await request(`/api/v1/marketing/companies/${companyId}`, { cookies: login.cookies }), [200]);

  const staff = check('POST company staff', await request('/api/v1/marketing/company-staffs', {
    method: 'POST', cookies: login.cookies,
    json: { companyId, name: `John Test ${runId}`, title: 'mr', telp: '+628123456789', email: `john.${runId}@example.com` },
  }), [201], (body) => body?.data?.version === 0 && body?.data?.revoked === false);
  companyStaffId = staff.body.data.id;
  check('POST duplicate normalized company staff', await request('/api/v1/marketing/company-staffs', {
    method: 'POST', cookies: login.cookies,
    json: { companyId, name: `JOHN   TEST   ${runId}`, title: 'mr' },
  }), [409]);
  check('GET company staff', await request(`/api/v1/marketing/company-staffs?companyId=${companyId}`, { cookies: login.cookies }), [200], (body) => body?.data?.staffs?.some((item) => item.id === companyStaffId));
  check('GET company staff detail', await request(`/api/v1/marketing/company-staffs/${companyStaffId}`, { cookies: login.cookies }), [200]);
  check('PATCH company staff', await request(`/api/v1/marketing/company-staffs/${companyStaffId}`, {
    method: 'PATCH', cookies: login.cookies,
    json: { version: staff.body.data.version, name: `Jane Test ${runId}`, title: 'mrs', telp: '+628987654321' },
  }), [200], (body) => body?.data?.title === 'mrs'
    && body?.data?.version === staff.body.data.version + 1
    && body?.data?.normalizeName === `janetest${runId}`);

  const previousCompanyId = companyId;
  const previousStaffId = companyStaffId;
  const companyVersion = check('PATCH company creates new version', await request(`/api/v1/marketing/companies/${companyId}`, {
    method: 'PATCH', cookies: login.cookies,
    json: { version: company.body.data.version, name: updatedCompanyName, isSisterCompany: true },
  }), [200], (body) => body?.data?.id === previousCompanyId && body?.data?.version === 1 && body?.data?.isSisterCompany === true);
  companyId = companyVersion.body.data.id;
  check('Company ID remains readable', await request(`/api/v1/marketing/companies/${previousCompanyId}`, { cookies: login.cookies }), [200]);
  const copiedStaffs = check('Company staff retains ID and version', await request(`/api/v1/marketing/company-staffs?companyId=${companyId}`, {
    cookies: login.cookies,
  }), [200], (body) => body?.data?.staffs?.length === 1
    && body.data.staffs[0].id === previousStaffId
    && body.data.staffs[0].version === staff.body.data.version + 1
    && body.data.staffs[0].telp === '+628987654321');
  companyStaffId = copiedStaffs.body.data.staffs[0].id;

  for (const type of [undefined, null, 'INVALID', 'tubular', 1]) {
    check(`POST services rejects type ${String(type)}`, await request('/api/v1/marketing/services', {
      method: 'POST', cookies: login.cookies,
      json: { name: 'Invalid service type', type, hasMaintenance: false },
    }), [400]);
  }
  const service = check('POST services', await request('/api/v1/marketing/services', {
    method: 'POST', cookies: login.cookies,
    json: {
      name: 'Campaign Management',
      type: 'TUBULAR',
      hasMaintenance: true,
      scopes: ['Planning', 'Execution'],
      maintenanceScopes: ['Inspection', 'Cleaning'],
    },
  }), [201], (body) => body?.data?.officeBranchId === officeBranchId && body?.data?.type === 'TUBULAR' && body?.data?.maintenanceScopes?.length === 2);
  serviceId = service.body.data.id;
  if (service.body.data.scopes?.length !== 2) throw new Error('POST services did not create scopes');
  check('GET services returns joined scopes', await request('/api/v1/marketing/services?name=Campaign%20Management&sortBy=name&sortOrder=asc', { cookies: login.cookies }), [200],
    (body) => body?.data?.services?.some((item) => item.id === serviceId
      && item.type === 'TUBULAR'
      && item.scopes === 'Planning, Execution'
      && item.maintenanceScopes === 'Inspection, Cleaning'));
  check('GET services rejects unsupported sort field', await request('/api/v1/marketing/services?sortBy=updatedAt', { cookies: login.cookies }), [400]);
  check('GET service detail', await request(`/api/v1/marketing/services/${serviceId}`, { cookies: login.cookies }), [200]);
  for (const type of [null, 'INVALID', 'octg', 1]) {
    check(`PATCH service rejects type ${String(type)}`, await request(`/api/v1/marketing/services/${serviceId}`, {
      method: 'PATCH', cookies: login.cookies, json: { type },
    }), [400]);
  }
  check('PATCH service type', await request(`/api/v1/marketing/services/${serviceId}`, {
    method: 'PATCH', cookies: login.cookies, json: { type: 'OCTG' },
  }), [200], (body) => body?.data?.type === 'OCTG');
  check('PATCH service', await request(`/api/v1/marketing/services/${serviceId}`, {
    method: 'PATCH', cookies: login.cookies,
    json: { name: 'Campaign Management Updated', maintenanceScopes: ['Inspection', 'Repair'] },
  }), [200], (body) => body?.data?.type === 'OCTG'
    && body?.data?.maintenanceScopes?.map((scope) => scope.scope).sort().join(',') === 'Inspection,Repair');
  const serviceScope = check('POST single service scope', await request(`/api/v1/marketing/services/${serviceId}/scopes`, {
    method: 'POST', cookies: login.cookies, json: { scope: `Single Service Scope ${runId}` },
  }), [201], (body) => body?.data?.serviceId === serviceId && body?.data?.revoked === false);
  check('POST duplicate active service scope', await request(`/api/v1/marketing/services/${serviceId}/scopes`, {
    method: 'POST', cookies: login.cookies, json: { scope: `Single Service Scope ${runId}` },
  }), [409]);
  check('DELETE service scope performs soft delete', await request(`/api/v1/marketing/services/${serviceId}/scopes/${serviceScope.body.data.id}`, {
    method: 'DELETE', cookies: login.cookies,
  }), [200], (body) => body?.data?.revoked === true);
  const revokedServiceScope = await marketingPrisma.serviceScope.findUnique({ where: { id: serviceScope.body.data.id } });
  if (!revokedServiceScope?.revoked) throw new Error('DELETE service scope did not persist revoked=true');
  check('GET service excludes revoked scope', await request(`/api/v1/marketing/services/${serviceId}`, { cookies: login.cookies }), [200],
    (body) => !body?.data?.scopes?.some((scope) => scope.id === serviceScope.body.data.id));

  const maintenanceScope = check('POST single maintenance scope', await request(`/api/v1/marketing/services/${serviceId}/maintenance/scopes`, {
    method: 'POST', cookies: login.cookies, json: { scope: `Single Maintenance Scope ${runId}` },
  }), [201], (body) => body?.data?.serviceId === serviceId && body?.data?.revoked === false);
  check('POST duplicate active maintenance scope', await request(`/api/v1/marketing/services/${serviceId}/maintenance/scopes`, {
    method: 'POST', cookies: login.cookies, json: { scope: `Single Maintenance Scope ${runId}` },
  }), [409]);
  check('DELETE maintenance scope performs soft delete', await request(`/api/v1/marketing/services/${serviceId}/maintenance/scopes/${maintenanceScope.body.data.id}`, {
    method: 'DELETE', cookies: login.cookies,
  }), [200], (body) => body?.data?.revoked === true);
  const revokedMaintenanceScope = await marketingPrisma.maintenanceScope.findUnique({ where: { id: maintenanceScope.body.data.id } });
  if (!revokedMaintenanceScope?.revoked) throw new Error('DELETE maintenance scope did not persist revoked=true');
  check('GET service excludes revoked maintenance scope', await request(`/api/v1/marketing/services/${serviceId}`, { cookies: login.cookies }), [200],
    (body) => !body?.data?.maintenanceScopes?.some((scope) => scope.id === maintenanceScope.body.data.id));

  const racingScopeName = `Racing Scope ${runId}`;
  const scopeRace = await Promise.all(Array.from({ length: 8 }, () => request(`/api/v1/marketing/services/${serviceId}/scopes`, {
    method: 'POST', cookies: login.cookies, json: { scope: racingScopeName },
  })));
  const racingScopeRows = await marketingPrisma.serviceScope.count({ where: { serviceId, scope: racingScopeName, revoked: false } });
  check('Concurrent service scope requests preserve one active row', {
    status: scopeRace.every((result) => [201, 409].includes(result.status)) && racingScopeRows === 1 ? 200 : 500,
    body: { statuses: summarizeStatuses(scopeRace), activeRows: racingScopeRows },
  }, [200]);

  const lostUpdateName = `Lost Update Safe ${runId}`;
  const lostUpdateScopes = [`Lost Update Scope ${runId}`];
  const lostUpdateRace = await Promise.all([
    request(`/api/v1/marketing/services/${serviceId}`, {
      method: 'PATCH', cookies: login.cookies, json: { name: lostUpdateName },
    }),
    request(`/api/v1/marketing/services/${serviceId}`, {
      method: 'PATCH', cookies: login.cookies, json: { scopes: lostUpdateScopes },
    }),
  ]);
  const serviceAfterLostUpdateRace = await request(`/api/v1/marketing/services/${serviceId}`, { cookies: login.cookies });
  check('Concurrent disjoint service updates do not lose either change', {
    status: lostUpdateRace.every((result) => result.status === 200)
      && serviceAfterLostUpdateRace.status === 200
      && serviceAfterLostUpdateRace.body?.data?.name === lostUpdateName
      && serviceAfterLostUpdateRace.body?.data?.scopes?.map((scope) => scope.scope).join(',') === lostUpdateScopes[0]
      ? 200 : 500,
    body: { patchStatuses: summarizeStatuses(lostUpdateRace), service: serviceAfterLostUpdateRace.body?.data },
  }, [200]);

  const item = check('POST item', await request('/api/v1/marketing/items', {
    method: 'POST', cookies: login.cookies,
    json: {
      serviceId,
      name: `Endpoint Item ${runId}`,
      sizes: [{
        size: `Size ${runId}`,
        priceServicePrimary: 100,
        priceServiceSisterCompany: 90,
        priceMaintenancePrimary: 50,
        priceMaintenanceSisterCompany: 40,
      }],
    },
  }), [201], (body) => body?.data?.officeBranchId === officeBranchId
    && body?.data?.createdById === tokenPayload.sub
    && body?.data?.createdByName === 'Marketing API Test'
    && body?.data?.updatedById === null
    && body?.data?.updatedByName === null
    && body?.data?.sizes?.length === 1);
  itemId = item.body.data.id;
  const createdItemSize = await marketingPrisma.itemSize.findFirst({
    where: { itemId, isActive: true },
    include: { price: true },
  });
  if (!createdItemSize?.price
    || Number(createdItemSize.price.priceServicePrimary) !== 100
    || Number(createdItemSize.price.priceServiceSisterCompany) !== 90
    || Number(createdItemSize.price.priceMaintenancePrimary) !== 50
    || Number(createdItemSize.price.priceMaintenanceSisterCompany) !== 40
    || createdItemSize.createdById !== tokenPayload.sub
    || createdItemSize.createdByName !== 'Marketing API Test'
    || createdItemSize.updatedById !== null
    || createdItemSize.updatedByName !== null
    || createdItemSize.price.createdById !== tokenPayload.sub
    || createdItemSize.price.createdByName !== 'Marketing API Test'
    || createdItemSize.price.updatedById !== null
    || createdItemSize.price.updatedByName !== null
    || !createdItemSize.price.isActive
    || !createdItemSize.price.effectiveFrom
    || createdItemSize.price.effectiveUntil !== null) {
    throw new Error('POST item did not persist prices in item_prices');
  }
  const contract = await marketingPrisma.companyContract.create({ data: {
    status: 'ACTIVE',
    companyId, effectiveFrom: new Date(), effectiveUntil: null,
    createdById: tokenPayload.sub, createdByName: 'Marketing API Test',
  } });
  const contractPrice = await marketingPrisma.companyContractPrice.create({
    data: {
      contractId: contract.id,
      itemSizeId: createdItemSize.id,
      priceService: 80,
      priceMaintenance: 35,
      createdById: tokenPayload.sub,
      createdByName: 'Marketing API Test',
    },
  });
  const storedContractPrice = await marketingPrisma.companyContractPrice.findUnique({ where: { id: contractPrice.id } });
  if (!storedContractPrice
    || Number(storedContractPrice.priceService) !== 80
    || Number(storedContractPrice.priceMaintenance) !== 35
    || storedContractPrice.createdById !== tokenPayload.sub
    || storedContractPrice.createdByName !== 'Marketing API Test'
    || storedContractPrice.updatedById !== null
    || storedContractPrice.updatedByName !== null
    || !storedContractPrice.isActive
    || !storedContractPrice.effectiveFrom
    || storedContractPrice.effectiveUntil !== null) {
    throw new Error('Company contract price was not persisted');
  }
  check('GET items', await request(`/api/v1/marketing/items?name=${encodeURIComponent(`Endpoint Item ${runId}`)}&serviceName=${encodeURIComponent(lostUpdateName)}&sortBy=serviceName&sortOrder=asc`, {
    cookies: login.cookies,
  }), [200], (body) => body?.data?.items?.some((row) => row.id === itemId
    && row.service?.name === lostUpdateName
    && row.sizes === undefined));
  check('GET items rejects removed size filter', await request('/api/v1/marketing/items?size=Large', {
    cookies: login.cookies,
  }), [400]);
  check('GET item detail', await request(`/api/v1/marketing/items/${itemId}`, { cookies: login.cookies }), [200],
    (body) => body?.data?.id === itemId && body?.data?.sizes === undefined);
  check('GET active item sizes', await request(`/api/v1/marketing/items/sizes?itemId=${itemId}&size=${encodeURIComponent(`Size ${runId}`)}&sortBy=size&sortOrder=asc`, {
    cookies: login.cookies,
  }), [200], (body) => body?.data?.sizes?.length === 1
    && body.data.sizes[0].id === createdItemSize.id
    && body?.data?.pagination?.total === 1);
  check('GET item sizes accepts optional itemId', await request('/api/v1/marketing/items/sizes', {
    cookies: login.cookies,
  }), [200]);
  check('POST item size validates required primary price', await request('/api/v1/marketing/items/sizes', {
    method: 'POST', cookies: login.cookies,
    json: { itemId, size: `Invalid Size ${runId}` },
  }), [400]);
  const addedSize = check('POST single item size', await request('/api/v1/marketing/items/sizes', {
    method: 'POST', cookies: login.cookies,
    json: {
      itemId,
      size: `Added Size ${runId}`,
      itemVersion: (await marketingPrisma.item.findUniqueOrThrow({ where: { id: itemId } })).version,
      priceServicePrimary: 110, priceServiceSisterCompany: 0, priceMaintenancePrimary: 50, priceMaintenanceSisterCompany: 40,
    },
  }), [201], (body) => body?.data?.itemId === itemId
    && body?.data?.size === `Added Size ${runId}`
    && Number(body?.data?.priceServicePrimary) === 110
    && Number(body?.data?.priceServiceSisterCompany) === 0
    && body?.data?.createdById === tokenPayload.sub
    && body?.data?.createdByName === 'Marketing API Test');
  const addedItemSize = await marketingPrisma.itemSize.findFirst({
    where: { id: addedSize.body.data.id, itemId, isActive: true },
    include: { price: true },
  });
  if (!addedItemSize?.price
    || Number(addedItemSize.price.priceServicePrimary) !== 110
    || Number(addedItemSize.price.priceServiceSisterCompany) !== 0
    || Number(addedItemSize.price.priceMaintenancePrimary) !== 50
    || addedItemSize.createdById !== tokenPayload.sub
    || addedItemSize.updatedById !== null) {
    throw new Error('POST item size did not persist ItemSize and ItemPrice atomically');
  }
  check('POST duplicate item size returns conflict', await request('/api/v1/marketing/items/sizes', {
    method: 'POST', cookies: login.cookies,
    json: { itemId, itemVersion: addedSize.body.data.itemVersion, size: `Added Size ${runId}`, priceServicePrimary: 120, priceServiceSisterCompany: 0, priceMaintenancePrimary: 50, priceMaintenanceSisterCompany: 40 },
  }), [409]);
  check('DELETE one item size', await request(`/api/v1/marketing/items/sizes/${addedItemSize.id}`, {
    method: 'DELETE', cookies: login.cookies, json: { version: addedItemSize.version },
  }), [200], (body) => body?.data?.id === addedItemSize.id
    && body?.data?.isActive === false
    && body?.data?.updatedById === tokenPayload.sub
    && body?.data?.updatedByName === 'Marketing API Test');
  const [itemAfterSizeDelete, originalSizeAfterSizeDelete, removedSizePrice] = await Promise.all([
    marketingPrisma.item.findUnique({ where: { id: itemId } }),
    marketingPrisma.itemSize.findUnique({ where: { id: createdItemSize.id } }),
    marketingPrisma.itemPrice.findUnique({ where: { itemSizeId: addedItemSize.id } }),
  ]);
  if (!itemAfterSizeDelete?.isActive
    || !originalSizeAfterSizeDelete?.isActive
    || removedSizePrice?.isActive !== false
    || !removedSizePrice.effectiveUntil
    || removedSizePrice.updatedById !== tokenPayload.sub) {
    throw new Error('DELETE one item size changed its parent or did not close its price');
  }
  check('DELETE inactive item size returns conflict', await request(`/api/v1/marketing/items/sizes/${addedItemSize.id}`, {
    method: 'DELETE', cookies: login.cookies, json: { version: addedItemSize.version },
  }), [409]);
  check('GET item sizes excludes inactive size', await request(`/api/v1/marketing/items/sizes?itemId=${itemId}`, {
    cookies: login.cookies,
  }), [200], (body) => body?.data?.sizes?.length === 1
    && body.data.sizes[0].id === createdItemSize.id);
  check('PATCH item requires version', await request(`/api/v1/marketing/items/${itemId}`, {
    method: 'PATCH', cookies: login.cookies, json: { name: 'Not allowed' },
  }), [400]);
  check('DELETE item', await request(`/api/v1/marketing/items/${itemId}`, {
    method: 'DELETE', cookies: login.cookies, json: { version: (await marketingPrisma.item.findUniqueOrThrow({ where: { id: itemId } })).version },
  }), [200], (body) => body?.data?.isActive === false
    && body?.data?.updatedById === tokenPayload.sub
    && body?.data?.updatedByName === 'Marketing API Test');
  const [inactivePreviousPrice, inactiveAddedPrice, inactiveContractPrice] = await Promise.all([
    marketingPrisma.itemPrice.findUnique({ where: { itemSizeId: createdItemSize.id } }),
    marketingPrisma.itemPrice.findUnique({ where: { itemSizeId: addedItemSize.id } }),
    marketingPrisma.companyContractPrice.findUnique({ where: { id: contractPrice.id } }),
  ]);
  if ([inactivePreviousPrice, inactiveAddedPrice, inactiveContractPrice].some((priceRow) => (
    priceRow?.isActive !== false
    || !priceRow.effectiveUntil
    || priceRow.updatedById !== tokenPayload.sub
    || priceRow.updatedByName !== 'Marketing API Test'
  ))) throw new Error('DELETE item did not close all item and contract price periods');
  check('GET items excludes inactive item', await request(`/api/v1/marketing/items?name=${encodeURIComponent(`Endpoint Item ${runId}`)}`, {
    cookies: login.cookies,
  }), [200], (body) => !body?.data?.items?.some((row) => row.id === itemId));
  itemId = undefined;
  check('DELETE missing item returns not found', await request(`/api/v1/marketing/items/${randomUUID()}`, {
    method: 'DELETE', cookies: login.cookies, json: { version: 0 },
  }), [404]);

  await runLoad('Concurrent service detail stress test', stressTotal, stressConcurrency,
    () => request(`/api/v1/marketing/services/${serviceId}`, { cookies: login.cookies }));
  check('DELETE service', await request(`/api/v1/marketing/services/${serviceId}`, { method: 'DELETE', cookies: login.cookies }), [200]);
  check('DELETE inactive service returns conflict', await request(`/api/v1/marketing/services/${serviceId}`, {
    method: 'DELETE', cookies: login.cookies,
  }), [409], (body) => body?.message === 'Service is already inactive');
  serviceId = undefined;
  check('DELETE company staff', await request(`/api/v1/marketing/company-staffs/${companyStaffId}`, {
    method: 'DELETE', cookies: login.cookies, json: { version: copiedStaffs.body.data.staffs[0].version },
  }), [200],
    (body) => body?.data?.revoked === true && body?.data?.version === copiedStaffs.body.data.staffs[0].version + 1);
  companyStaffId = undefined;
  check('DELETE company', await request(`/api/v1/marketing/companies/${companyId}`, {
    method: 'DELETE', cookies: login.cookies, json: { version: companyVersion.body.data.version },
  }), [200]);
  companyId = undefined;
  console.log(JSON.stringify({ runId, passed: checks.length, failed: 0, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ runId, passed: checks.filter((item) => item.passed).length, failed: 1, error: error.message, checks }, null, 2));
  process.exitCode = 1;
} finally {
  if (itemId) await marketingPrisma.item.deleteMany({ where: { id: itemId } }).catch(() => undefined);
  if (serviceId) await marketingPrisma.service.deleteMany({ where: { id: serviceId } }).catch(() => undefined);
  if (foreignServiceId) await marketingPrisma.service.deleteMany({ where: { id: foreignServiceId } }).catch(() => undefined);
  if (foreignCompanyId) await marketingPrisma.company.deleteMany({ where: { id: foreignCompanyId } }).catch(() => undefined);
  await marketingPrisma.companyHistory.deleteMany({ where: { company: { normalizeName: { in: companyNormalizeNames } } } }).catch(() => undefined);
  await marketingPrisma.company.deleteMany({ where: { normalizeName: { in: companyNormalizeNames } } }).catch(() => undefined);
  await authPrisma.user.deleteMany({ where: { normalizeUsername: username.toLowerCase() } }).catch(() => undefined);
  await Promise.all([marketingPrisma.$disconnect(), authPrisma.$disconnect()]);
}
