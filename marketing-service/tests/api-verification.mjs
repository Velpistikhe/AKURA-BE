import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { PrismaClient as MarketingPrismaClient } from '@prisma/client';

const requireFromAuth = createRequire(new URL('../../auth-service/package.json', import.meta.url));
const { PrismaClient: AuthPrismaClient } = requireFromAuth('@prisma/client');
const gatewayUrl = process.env.TEST_GATEWAY_URL || 'http://localhost:5000';
const runId = `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
const username = `marketing_${runId}`.slice(0, 50);
const password = 'MarketingTest-123!';
const serviceCode = `SVC_${runId}`.toUpperCase();
const maintenanceCode = `MNT_${runId}`.toUpperCase();
const companyName = `Test Company ${runId}`;
const updatedCompanyName = `Updated Test Company ${runId}`;
const companyNormalizeNames = [companyName, updatedCompanyName].map((name) => name.toLowerCase().replace(/\s+/g, ''));
const checks = [];
let companyId;
let companyStaffId;
let serviceId;
let maintenanceId;

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

try {
  check('Gateway rejects missing token', await request('/api/v1/marketing/companies'), [401]);
  check('OpenAPI exposes marketing endpoints', await request('/api-docs.json'), [200], (body) => [
    '/api/v1/marketing/companies', '/api/v1/marketing/companies/{companyId}',
    '/api/v1/marketing/company-staffs', '/api/v1/marketing/company-staffs/{companyStaffId}',
    '/api/v1/marketing/services', '/api/v1/marketing/services/{serviceId}',
    '/api/v1/marketing/services/{serviceId}/scopes', '/api/v1/marketing/services/{serviceId}/scopes/{scopeId}',
    '/api/v1/marketing/maintenances', '/api/v1/marketing/maintenances/{maintenanceId}',
    '/api/v1/marketing/maintenances/{maintenanceId}/scopes', '/api/v1/marketing/maintenances/{maintenanceId}/scopes/{scopeId}',
  ].every((path) => body?.paths?.[path]));

  check('Register test user', await request('/api/v1/auth/register', {
    method: 'POST', json: { username, password, passwordConfirmation: password, firstName: 'Marketing', lastName: 'API Test' },
  }), [201]);
  await authPrisma.user.update({
    where: { normalizeUsername: username.toLowerCase() },
    data: { section: 'MARKETING', version: { increment: 1 } },
  });
  const login = check('Login marketing user', await request('/api/v1/auth/login', { method: 'POST', json: { username, password } }), [200]);

  const company = check('POST companies', await request('/api/v1/marketing/companies', {
    method: 'POST', cookies: login.cookies,
    json: { name: companyName, type: 'CUSTOMER', address: 'Jakarta', hasContract: false },
  }), [201], (body) => body?.data?.normalizeName === companyNormalizeNames[0] && body?.data?.version === 0);
  companyId = company.body.data.id;
  check('POST duplicate normalized company', await request('/api/v1/marketing/companies', {
    method: 'POST', cookies: login.cookies,
    json: { name: companyName.toUpperCase().replaceAll(' ', '   '), type: 'CUSTOMER', address: 'Bandung' },
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
    json: { name: `Jane Test ${runId}`, title: 'mrs', telp: '+628987654321' },
  }), [200], (body) => body?.data?.title === 'mrs' && body?.data?.normalizeName === `janetest${runId}`);

  const previousCompanyId = companyId;
  const previousStaffId = companyStaffId;
  const companyVersion = check('PATCH company creates new version', await request(`/api/v1/marketing/companies/${companyId}`, {
    method: 'PATCH', cookies: login.cookies, json: { name: updatedCompanyName, hasContract: true },
  }), [200], (body) => body?.data?.id !== previousCompanyId && body?.data?.version === 1 && body?.data?.hasContract === true);
  companyId = companyVersion.body.data.id;
  check('Previous company version is revoked', await request(`/api/v1/marketing/companies/${previousCompanyId}`, { cookies: login.cookies }), [404]);
  const copiedStaffs = check('Company staff copied to new company version', await request(`/api/v1/marketing/company-staffs?companyId=${companyId}`, {
    cookies: login.cookies,
  }), [200], (body) => body?.data?.staffs?.length === 1
    && body.data.staffs[0].id !== previousStaffId
    && body.data.staffs[0].version === 0
    && body.data.staffs[0].telp === '+628987654321');
  companyStaffId = copiedStaffs.body.data.staffs[0].id;

  const service = check('POST services', await request('/api/v1/marketing/services', {
    method: 'POST', cookies: login.cookies,
    json: { code: serviceCode, name: 'Campaign Management', scopes: ['Planning', 'Execution'] },
  }), [201]);
  serviceId = service.body.data.id;
  if (service.body.data.scopes?.length !== 2) throw new Error('POST services did not create scopes');
  check('GET services returns joined scopes', await request(`/api/v1/marketing/services?code=${encodeURIComponent(serviceCode)}&sortBy=name&sortOrder=asc`, { cookies: login.cookies }), [200],
    (body) => body?.data?.services?.some((item) => item.id === serviceId && item.scopes === 'Planning, Execution'));
  check('GET services rejects unsupported sort field', await request('/api/v1/marketing/services?sortBy=updatedAt', { cookies: login.cookies }), [400]);
  check('GET service detail', await request(`/api/v1/marketing/services/${serviceId}`, { cookies: login.cookies }), [200]);
  check('PATCH service', await request(`/api/v1/marketing/services/${serviceId}`, { method: 'PATCH', cookies: login.cookies, json: { name: 'Campaign Management Updated' } }), [200]);
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

  const maintenance = check('POST maintenances', await request('/api/v1/marketing/maintenances', {
    method: 'POST', cookies: login.cookies,
    json: { code: maintenanceCode, name: 'Preventive Maintenance', scopes: ['Inspection', 'Cleaning'] },
  }), [201], (body) => body?.data?.scopes?.length === 2);
  maintenanceId = maintenance.body.data.id;
  check('GET maintenances returns joined scopes', await request('/api/v1/marketing/maintenances?name=Preventive%20Maintenance&sortBy=name&sortOrder=asc', { cookies: login.cookies }), [200],
    (body) => body?.data?.maintenances?.some((item) => item.id === maintenanceId && item.scopes === 'Inspection, Cleaning'));
  check('GET maintenances rejects unsupported search filter', await request('/api/v1/marketing/maintenances?search=Maintenance', { cookies: login.cookies }), [400]);
  check('GET maintenance detail', await request(`/api/v1/marketing/maintenances/${maintenanceId}`, { cookies: login.cookies }), [200], (body) => body?.data?.id === maintenanceId);
  const maintenanceScope = check('POST single maintenance scope', await request(`/api/v1/marketing/maintenances/${maintenanceId}/scopes`, {
    method: 'POST', cookies: login.cookies, json: { scope: `Single Maintenance Scope ${runId}` },
  }), [201], (body) => body?.data?.maintenanceId === maintenanceId && body?.data?.revoked === false);
  check('POST duplicate active maintenance scope', await request(`/api/v1/marketing/maintenances/${maintenanceId}/scopes`, {
    method: 'POST', cookies: login.cookies, json: { scope: `Single Maintenance Scope ${runId}` },
  }), [409]);
  check('DELETE maintenance scope performs soft delete', await request(`/api/v1/marketing/maintenances/${maintenanceId}/scopes/${maintenanceScope.body.data.id}`, {
    method: 'DELETE', cookies: login.cookies,
  }), [200], (body) => body?.data?.revoked === true);
  const revokedMaintenanceScope = await marketingPrisma.maintenanceScope.findUnique({ where: { id: maintenanceScope.body.data.id } });
  if (!revokedMaintenanceScope?.revoked) throw new Error('DELETE maintenance scope did not persist revoked=true');
  check('GET maintenance excludes revoked scope', await request(`/api/v1/marketing/maintenances/${maintenanceId}`, { cookies: login.cookies }), [200],
    (body) => !body?.data?.scopes?.some((scope) => scope.id === maintenanceScope.body.data.id));
  check('DELETE service', await request(`/api/v1/marketing/services/${serviceId}`, { method: 'DELETE', cookies: login.cookies }), [200]);
  serviceId = undefined;
  check('DELETE company staff', await request(`/api/v1/marketing/company-staffs/${companyStaffId}`, { method: 'DELETE', cookies: login.cookies }), [200],
    (body) => body?.data?.revoked === true && body?.data?.version === 1);
  companyStaffId = undefined;
  check('DELETE company', await request(`/api/v1/marketing/companies/${companyId}`, { method: 'DELETE', cookies: login.cookies }), [200]);
  companyId = undefined;
  console.log(JSON.stringify({ runId, passed: checks.length, failed: 0, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ runId, passed: checks.filter((item) => item.passed).length, failed: 1, error: error.message, checks }, null, 2));
  process.exitCode = 1;
} finally {
  if (serviceId) await marketingPrisma.service.deleteMany({ where: { id: serviceId } }).catch(() => undefined);
  if (maintenanceId) await marketingPrisma.maintenance.deleteMany({ where: { id: maintenanceId } }).catch(() => undefined);
  await marketingPrisma.company.deleteMany({ where: { normalizeName: { in: companyNormalizeNames } } }).catch(() => undefined);
  await authPrisma.user.deleteMany({ where: { normalizeUsername: username.toLowerCase() } }).catch(() => undefined);
  await Promise.all([marketingPrisma.$disconnect(), authPrisma.$disconnect()]);
}
