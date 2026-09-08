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
let noItemMenuId;
let menuAccessId;
let menuItemId;
let inaccessibleMenuItemId;
let officeBranchId;

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
  check(`POST /api/v1/auth/register (${label})`, result, [201], (body) => body?.data === undefined);
  const user = await authPrisma.user.findUnique({ where: { normalizeUsername: username.toLowerCase() } });
  if (!user) throw new Error(`Registered test user ${username} was not persisted`);
  return { username, password, cookies: result.cookies, user };
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
    ) === 64,
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

  const targetInitialLogin = check('POST /api/v1/auth/login (target)', await request('/api/v1/auth/login', {
    method: 'POST',
    json: { username: target.username, password: target.password },
  }), [200]);
  target.cookies = targetInitialLogin.cookies;

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

  const assignedOfficeBranchId = '00000000-0000-4000-8000-000000000001';
  detail = check('PATCH /api/v1/auth/users/{userId}', await request(`/api/v1/auth/users/${target.user.id}`, {
    method: 'PATCH', cookies: managerCookies,
    json: {
      role: 'USER', section: 'MARKETING', officeBranchId: assignedOfficeBranchId,
      isActive: false, version: detail.body.data.version,
    },
  }), [200], (body) => body?.data?.section === 'MARKETING'
    && body?.data?.officeBranchId === assignedOfficeBranchId
    && body?.data?.isActive === false);
  check('PATCH /api/v1/auth/users/{userId} rejects inactive target', await request(`/api/v1/auth/users/${target.user.id}`, {
    method: 'PATCH', cookies: managerCookies, json: { isActive: true, version: detail.body.data.version },
  }), [409], (body) => body?.message === 'Inactive users cannot be updated');

  const menuKey = `endpoint_test_${slug}`;
  const inaccessibleItemKey = `hidden_endpoint_item_${slug}`;
  let menu = check('POST /api/v1/app-manager/menus', await request('/api/v1/app-manager/menus', {
    method: 'POST',
    cookies: managerCookies,
    json: {
      key: menuKey,
      label: 'Endpoint Test Menu',
      hasItem: true,
      order: 9999,
      items: [{ key: inaccessibleItemKey, label: 'Hidden Endpoint Test Item', order: 2 }],
    },
  }), [201], (body) => body?.data?.hasItem === true);
  menuId = menu.body.data.id;
  inaccessibleMenuItemId = (await managerPrisma.menuItem.findUnique({ where: { key: inaccessibleItemKey } })).id;
  check('GET /api/v1/app-manager/menus', await request(`/api/v1/app-manager/menus?search=${menuKey}&hasItem=true&sortBy=hasItem&sortOrder=desc`, {
    cookies: managerCookies,
  }), [200], (body) => body?.data?.menus?.some((item) => item.id === menuId));
  check('GET /api/v1/app-manager/menus/{menuId}', await request(`/api/v1/app-manager/menus/${menuId}`, {
    cookies: managerCookies,
  }), [200]);
  menu = check('PATCH /api/v1/app-manager/menus/{menuId}', await request(`/api/v1/app-manager/menus/${menuId}`, {
    method: 'PATCH', cookies: managerCookies, json: { label: 'Updated Endpoint Test Menu' },
  }), [200]);
  check('PATCH /api/v1/app-manager/menus/{menuId} rejects hasItem=false while items exist', await request(`/api/v1/app-manager/menus/${menuId}`, {
    method: 'PATCH', cookies: managerCookies, json: { hasItem: false },
  }), [409]);

  const itemKey = `endpoint_item_${slug}`;
  check('POST /api/v1/app-manager/menu-items rejects removed path field', await request('/api/v1/app-manager/menu-items', {
    method: 'POST', cookies: managerCookies,
    json: { menuId, key: `path_${slug}`, label: 'Invalid Path Item', path: '/removed' },
  }), [400]);
  let item = check('POST /api/v1/app-manager/menu-items', await request('/api/v1/app-manager/menu-items', {
    method: 'POST',
    cookies: managerCookies,
    json: {
      menuId,
      key: itemKey,
      label: 'Endpoint Test Item',
      order: 1,
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

  check('GET /api/v1/app-manager/menu-items', await request(`/api/v1/app-manager/menu-items?menuId=${menuId}`, {
    cookies: managerCookies,
  }), [200], (body) => body?.data?.items?.some((entry) => entry.id === menuItemId));
  check('GET /api/v1/app-manager/menu-items/{menuItemId}', await request(`/api/v1/app-manager/menu-items/${menuItemId}`, {
    cookies: managerCookies,
  }), [200]);
  item = check('PATCH /api/v1/app-manager/menu-items/{menuItemId}', await request(`/api/v1/app-manager/menu-items/${menuItemId}`, {
    method: 'PATCH', cookies: managerCookies, json: {
      label: 'Updated Endpoint Test Item',
    },
  }), [200]);

  check('GET /api/v1/app-manager/menus/my-menus (matching item)', await request('/api/v1/app-manager/menus/my-menus', {
    cookies: target.cookies,
  }), [200], (body) => body?.data?.some((entry) => entry.key === menuKey
    && entry.items?.some((entryItem) => entryItem.key === itemKey)
    && !entry.items?.some((entryItem) => entryItem.key === inaccessibleItemKey)));

  const noItemMenuKey = `no_item_menu_${slug}`;
  check('POST /api/v1/app-manager/menus requires items when hasItem=true', await request('/api/v1/app-manager/menus', {
    method: 'POST', cookies: managerCookies,
    json: { key: `missing_items_${slug}`, label: 'Missing Items Menu', hasItem: true },
  }), [400]);
  check('POST /api/v1/app-manager/menus rejects items when hasItem=false', await request('/api/v1/app-manager/menus', {
    method: 'POST', cookies: managerCookies,
    json: { key: noItemMenuKey, label: 'No Item Menu', hasItem: false, items: [{ key: `invalid_${slug}`, label: 'Invalid' }] },
  }), [400]);
  const noItemMenu = check('POST /api/v1/app-manager/menus without items', await request('/api/v1/app-manager/menus', {
    method: 'POST', cookies: managerCookies,
    json: { key: noItemMenuKey, label: 'No Item Menu', hasItem: false },
  }), [201], (body) => body?.data?.hasItem === false);
  noItemMenuId = noItemMenu.body.data.id;
  check('POST /api/v1/app-manager/menu-items rejects parent with hasItem=false', await request('/api/v1/app-manager/menu-items', {
    method: 'POST', cookies: managerCookies,
    json: { menuId: noItemMenuId, key: `blocked_${slug}`, label: 'Blocked Item' },
  }), [409]);
  check('DELETE /api/v1/app-manager/menus/{menuId} (without items)', await request(`/api/v1/app-manager/menus/${noItemMenuId}`, {
    method: 'DELETE', cookies: managerCookies,
  }), [200]);
  noItemMenuId = undefined;

  const officeName = `Kantor Endpoint ${slug}`;
  const officeBranch = check('POST /api/v1/app-manager/office-branches', await request('/api/v1/app-manager/office-branches', {
    method: 'POST', cookies: managerCookies,
    json: {
      name: officeName,
      address: 'Jl. Endpoint No. 1, Jakarta',
      telp: '+62 21 555 0100',
      email: `office-${slug}@example.com`,
      isHead: false,
    },
  }), [201], (body) => body?.data?.name === officeName);
  officeBranchId = officeBranch.body.data.id;
  check('GET /api/v1/app-manager/office-branches/options', await request('/api/v1/app-manager/office-branches/options', {
    cookies: managerCookies,
  }), [200], (body) => body?.data?.some((entry) => entry.id === officeBranchId && entry.name === officeName));
  check('GET /api/v1/app-manager/office-branches', await request(`/api/v1/app-manager/office-branches?search=${encodeURIComponent(officeName)}&isHead=false&sortBy=name&sortOrder=asc`, {
    cookies: managerCookies,
  }), [200], (body) => body?.data?.officeBranches?.some((entry) => entry.id === officeBranchId));
  check('GET /api/v1/app-manager/office-branches/{officeBranchId}', await request(`/api/v1/app-manager/office-branches/${officeBranchId}`, {
    cookies: managerCookies,
  }), [200]);
  check('PATCH /api/v1/app-manager/office-branches/{officeBranchId}', await request(`/api/v1/app-manager/office-branches/${officeBranchId}`, {
    method: 'PATCH', cookies: managerCookies, json: { telp: '+62 21 555 0101' },
  }), [200], (body) => body?.data?.telp === '+62 21 555 0101');
  check('DELETE /api/v1/app-manager/office-branches/{officeBranchId}', await request(`/api/v1/app-manager/office-branches/${officeBranchId}`, {
    method: 'DELETE', cookies: managerCookies,
  }), [200]);
  officeBranchId = undefined;

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
  if (noItemMenuId) await managerPrisma.menu.deleteMany({ where: { id: noItemMenuId } }).catch(() => undefined);
  if (officeBranchId) await managerPrisma.officeBranch.deleteMany({ where: { id: officeBranchId } }).catch(() => undefined);
  if (createdUsernames.length) {
    await authPrisma.user.deleteMany({ where: { normalizeUsername: { in: createdUsernames } } }).catch(() => undefined);
  }
  await Promise.all([managerPrisma.$disconnect(), authPrisma.$disconnect()]);
}
