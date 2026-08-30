import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PrismaClient as ManagerPrismaClient } from '@prisma/client';

const requireFromAuth = createRequire(new URL('../../auth-service/package.json', import.meta.url));
const { PrismaClient: AuthPrismaClient } = requireFromAuth('@prisma/client');

const gatewayUrl = process.env.TEST_GATEWAY_URL || 'http://localhost:5000';

const readEnv = (path) => Object.fromEntries(
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, '')];
    }),
);

const localEnv = readEnv(new URL('../.env', import.meta.url));
const authEnv = readEnv(new URL('../../auth-service/.env', import.meta.url));
const managerPrisma = new ManagerPrismaClient({ datasources: { db: { url: localEnv.DATABASE_URL } } });
const authPrisma = new AuthPrismaClient({ datasources: { db: { url: authEnv.DATABASE_URL } } });
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slug = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
const createdUsernames = [];
const checks = [];
let managerCookies = '';
let menuId;
let menuAccessId;
let menuItemId;
let inaccessibleMenuItemId;

const cookieJarFrom = (response) => {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';', 1)[0]).join('; ');
};

const request = async (path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (options.cookies) headers.cookie = options.cookies;
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  try {
    const response = await fetch(`${gatewayUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: response.status, body, cookies: cookieJarFrom(response) };
  } catch (error) {
    return { status: 0, body: { message: error.message }, cookies: '' };
  }
};

const check = (operation, result, expected, predicate = () => true) => {
  const passed = expected.includes(result.status) && predicate(result.body);
  checks.push({ operation, passed, status: result.status, message: result.body?.message });
  if (!passed) {
    throw new Error(`${operation} failed: expected ${expected.join('/')} but received ${result.status} (${result.body?.message || 'no message'})`);
  }
  return result;
};

const register = async (label) => {
  const username = `${label}_${slug.slice(-18)}`;
  createdUsernames.push(username.toLowerCase());
  const password = 'EndpointTest-123!';
  const result = await request('/api/v1/auth/register', {
    method: 'POST',
    json: {
      username,
      password,
      passwordConfirmation: password,
      firstName: label,
      lastName: 'Endpoint Test',
    },
  });
  check(`POST /api/v1/auth/register (${label})`, result, [201], (body) => Boolean(body?.data?.user?.id));
  return { username, password, cookies: result.cookies, user: result.body.data.user };
};

try {
  check('GET /health', await request('/health'), [200]);
  check('GET /services', await request('/services'), [200]);
  const openApi = check('GET /api-docs.json', await request('/api-docs.json'), [200]);
  check('GET /api-docs', await request('/api-docs'), [200], (body) => typeof body === 'string');
  check(
    'OpenAPI operation count',
    { status: 200, body: { message: 'OpenAPI is complete' } },
    [200],
    () => Object.values(openApi.body.paths).reduce(
      (total, path) => total + Object.keys(path).filter((key) => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length,
      0,
    ) === 56,
  );
  check('GET /api/v1/auth/.well-known/jwks.json', await request('/api/v1/auth/.well-known/jwks.json'), [200], (body) => body?.keys?.length > 0);

  const manager = await register('manager');
  const target = await register('target');

  await authPrisma.user.update({
    where: { id: manager.user.id },
    data: { role: 'APP_MANAGER', version: { increment: 1 } },
  });

  const managerLogin = check('POST /api/v1/auth/login (manager)', await request('/api/v1/auth/login', {
    method: 'POST',
    json: { username: manager.username, password: manager.password },
  }), [200]);
  managerCookies = managerLogin.cookies;

  check('GET /api/v1/auth/me', await request('/api/v1/auth/me', { cookies: target.cookies }), [200]);
  const profile = check('PUT /api/v1/auth/profile', await request('/api/v1/auth/profile', {
    method: 'PUT',
    cookies: target.cookies,
    json: { firstName: 'Updated', lastName: 'Endpoint Test' },
  }), [200]);
  target.user = profile.body.data;

  const refreshed = check('POST /api/v1/auth/refresh-token', await request('/api/v1/auth/refresh-token', {
    method: 'POST', cookies: target.cookies,
  }), [200]);
  check('POST /api/v1/auth/logout', await request('/api/v1/auth/logout', {
    method: 'POST', cookies: refreshed.cookies,
  }), [200]);

  check('PUT /api/v1/auth/password', await request('/api/v1/auth/password', {
    method: 'PUT',
    cookies: target.cookies,
    json: {
      oldPassword: target.password,
      newPassword: 'EndpointTest-456!',
      newPasswordConfirmation: 'EndpointTest-456!',
    },
  }), [200]);
  target.password = 'EndpointTest-456!';
  const targetLogin = check('POST /api/v1/auth/login (updated password)', await request('/api/v1/auth/login', {
    method: 'POST', json: { username: target.username, password: target.password },
  }), [200]);
  target.cookies = targetLogin.cookies;

  check('GET /api/v1/app-manager/menus/my-menus', await request('/api/v1/app-manager/menus/my-menus', {
    cookies: target.cookies,
  }), [200], (body) => Array.isArray(body?.data));

  check('GET /api/v1/auth/users', await request(`/api/v1/auth/users?search=${encodeURIComponent(target.username)}`, {
    cookies: managerCookies,
  }), [200], (body) => body?.data?.users?.some((user) => user.id === target.user.id));
  let detail = check('GET /api/v1/auth/users/{userId}', await request(`/api/v1/auth/users/${target.user.id}`, {
    cookies: managerCookies,
  }), [200]);

  detail = check('PATCH /api/v1/auth/users/{userId}/role', await request(`/api/v1/auth/users/${target.user.id}/role`, {
    method: 'PATCH', cookies: managerCookies, json: { role: 'USER', version: detail.body.data.version },
  }), [200]);
  detail = check('PATCH /api/v1/auth/users/{userId}/section', await request(`/api/v1/auth/users/${target.user.id}/section`, {
    method: 'PATCH', cookies: managerCookies, json: { section: 'MARKETING', version: detail.body.data.version },
  }), [200]);
  detail = check('PATCH /api/v1/auth/users/{userId}/status (deactivate)', await request(`/api/v1/auth/users/${target.user.id}/status`, {
    method: 'PATCH', cookies: managerCookies, json: { isActive: false, version: detail.body.data.version },
  }), [200]);
  detail = check('PATCH /api/v1/auth/users/{userId}/status (reactivate)', await request(`/api/v1/auth/users/${target.user.id}/status`, {
    method: 'PATCH', cookies: managerCookies, json: { isActive: true, version: detail.body.data.version },
  }), [200]);

  const menuKey = `endpoint_test_${slug}`;
  let menu = check('POST /api/v1/app-manager/menus', await request('/api/v1/app-manager/menus', {
    method: 'POST',
    cookies: managerCookies,
    json: { key: menuKey, label: 'Endpoint Test Menu', order: 9999 },
  }), [201]);
  menuId = menu.body.data.id;
  check('GET /api/v1/app-manager/menus', await request(`/api/v1/app-manager/menus?search=${menuKey}`, {
    cookies: managerCookies,
  }), [200], (body) => body?.data?.menus?.some((item) => item.id === menuId));
  check('GET /api/v1/app-manager/menus/{menuId}', await request(`/api/v1/app-manager/menus/${menuId}`, {
    cookies: managerCookies,
  }), [200]);
  menu = check('PATCH /api/v1/app-manager/menus/{menuId}', await request(`/api/v1/app-manager/menus/${menuId}`, {
    method: 'PATCH', cookies: managerCookies, json: { label: 'Updated Endpoint Test Menu' },
  }), [200]);

  const itemKey = `endpoint_item_${slug}`;
  let item = check('POST /api/v1/app-manager/menu-items', await request('/api/v1/app-manager/menu-items', {
    method: 'POST',
    cookies: managerCookies,
    json: {
      menuId,
      key: itemKey,
      label: 'Endpoint Test Item',
      path: `/endpoint-test/${slug}`,
      order: 1,
      role: 'USER',
      section: 'MARKETING',
    },
  }), [201]);
  menuItemId = item.body.data.id;

  let menuAccess = check('POST /api/v1/app-manager/menu-accesses', await request('/api/v1/app-manager/menu-accesses', {
    method: 'POST', cookies: managerCookies, json: { menuItemId, role: 'USER', section: 'MARKETING' },
  }), [201]);
  menuAccessId = menuAccess.body.data.id;
  check('GET /api/v1/app-manager/menu-accesses', await request(`/api/v1/app-manager/menu-accesses?menuItemId=${menuItemId}`, {
    cookies: managerCookies,
  }), [200], (body) => body?.data?.menuAccesses?.some((access) => access.id === menuAccessId));
  check('GET /api/v1/app-manager/menu-accesses/{menuAccessId}', await request(`/api/v1/app-manager/menu-accesses/${menuAccessId}`, {
    cookies: managerCookies,
  }), [200]);
  menuAccess = check('PATCH /api/v1/app-manager/menu-accesses/{menuAccessId}', await request(`/api/v1/app-manager/menu-accesses/${menuAccessId}`, {
    method: 'PATCH', cookies: managerCookies, json: { role: null },
  }), [200], (body) => body?.data?.role === null && body?.data?.section === 'MARKETING');

  const inaccessibleItemKey = `hidden_endpoint_item_${slug}`;
  const inaccessibleItem = check('POST /api/v1/app-manager/menu-items (without access)', await request('/api/v1/app-manager/menu-items', {
    method: 'POST', cookies: managerCookies,
    json: { menuId, key: inaccessibleItemKey, label: 'Hidden Endpoint Test Item', path: `/hidden-endpoint-test/${slug}`, order: 2 },
  }), [201]);
  inaccessibleMenuItemId = inaccessibleItem.body.data.id;
  check('GET /api/v1/app-manager/menu-items', await request(`/api/v1/app-manager/menu-items?menuId=${menuId}`, {
    cookies: managerCookies,
  }), [200], (body) => body?.data?.items?.some((entry) => entry.id === menuItemId));
  check('GET /api/v1/app-manager/menu-items/{menuItemId}', await request(`/api/v1/app-manager/menu-items/${menuItemId}`, {
    cookies: managerCookies,
  }), [200]);
  item = check('PATCH /api/v1/app-manager/menu-items/{menuItemId}', await request(`/api/v1/app-manager/menu-items/${menuItemId}`, {
    method: 'PATCH', cookies: managerCookies, json: {
      label: 'Updated Endpoint Test Item', role: null, section: null,
    },
  }), [200]);

  check('GET /api/v1/app-manager/menus/my-menus (matching item)', await request('/api/v1/app-manager/menus/my-menus', {
    cookies: target.cookies,
  }), [200], (body) => body?.data?.some((entry) => entry.key === menuKey
    && entry.items?.some((entryItem) => entryItem.key === itemKey)
    && !entry.items?.some((entryItem) => entryItem.key === inaccessibleItemKey)));

  check('DELETE /api/v1/app-manager/menu-accesses/{menuAccessId}', await request(`/api/v1/app-manager/menu-accesses/${menuAccessId}`, {
    method: 'DELETE', cookies: managerCookies,
  }), [200]);
  menuAccessId = undefined;
  check('DELETE /api/v1/app-manager/menu-items/{menuItemId}', await request(`/api/v1/app-manager/menu-items/${menuItemId}`, {
    method: 'DELETE', cookies: managerCookies,
  }), [200]);
  menuItemId = undefined;
  check('DELETE /api/v1/app-manager/menu-items/{inaccessibleMenuItemId}', await request(`/api/v1/app-manager/menu-items/${inaccessibleMenuItemId}`, {
    method: 'DELETE', cookies: managerCookies,
  }), [200]);
  inaccessibleMenuItemId = undefined;
  check('DELETE /api/v1/app-manager/menus/{menuId}', await request(`/api/v1/app-manager/menus/${menuId}`, {
    method: 'DELETE', cookies: managerCookies,
  }), [200]);
  menuId = undefined;

  console.log(JSON.stringify({ runId, passed: checks.length, failed: 0, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ runId, passed: checks.filter((item) => item.passed).length, failed: 1, error: error.message, checks }, null, 2));
  process.exitCode = 1;
} finally {
  if (menuItemId) await managerPrisma.menuItem.deleteMany({ where: { id: menuItemId } }).catch(() => undefined);
  if (inaccessibleMenuItemId) await managerPrisma.menuItem.deleteMany({ where: { id: inaccessibleMenuItemId } }).catch(() => undefined);
  if (menuAccessId) await managerPrisma.menuAccess.deleteMany({ where: { id: menuAccessId } }).catch(() => undefined);
  if (menuId) await managerPrisma.menu.deleteMany({ where: { id: menuId } }).catch(() => undefined);
  if (createdUsernames.length) {
    await authPrisma.user.deleteMany({ where: { normalizeUsername: { in: createdUsernames } } }).catch(() => undefined);
  }
  await Promise.all([managerPrisma.$disconnect(), authPrisma.$disconnect()]);
}
