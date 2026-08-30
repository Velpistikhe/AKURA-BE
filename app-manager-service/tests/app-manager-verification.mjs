import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireFromAuth = createRequire(new URL('../../auth-service/package.json', import.meta.url));
const { PrismaClient } = requireFromAuth('@prisma/client');

const gatewayUrl = process.env.TEST_GATEWAY_URL || 'http://localhost:5000';
const managerUrl = process.env.TEST_MANAGER_URL || 'http://localhost:5002';

const readEnv = (path) => Object.fromEntries(
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, '')];
    }),
);

const authEnv = readEnv(new URL('../../auth-service/.env', import.meta.url));
const prisma = new PrismaClient({ datasources: { db: { url: authEnv.DATABASE_URL } } });
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUsernames = [];
const checks = [];

const cookieJarFrom = (response) => {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';', 1)[0]).join('; ');
};

const cookieValue = (cookieJar, name) => {
  const match = cookieJar.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
};

const request = async (base, path, options = {}) => {
  const headers = { ...(options.headers || {}) };
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  try {
    const response = await fetch(`${base}${path}`, {
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
    return { status: 0, error: error.message, cookies: '' };
  }
};

const check = (name, passed, evidence) => checks.push({ name, passed, evidence });

const register = async (label) => {
  const username = `${label}_${runId.replace(/[^a-z0-9]/gi, '').slice(-16)}`;
  createdUsernames.push(username.toLowerCase());
  const result = await request(gatewayUrl, '/api/v1/auth/register', {
    method: 'POST',
    json: {
      username,
      password: 'ManagerTest-123!',
      passwordConfirmation: 'ManagerTest-123!',
      firstName: label,
      lastName: 'Test',
    },
  });
  return { ...result, username, user: result.body?.data?.user };
};

try {
  const health = await request(managerUrl, '/health');
  check('App Manager health', health.status === 200, { status: health.status });

  const openApi = await request(gatewayUrl, '/api-docs.json');
  const managerPaths = [
    '/api/v1/auth/users',
    '/api/v1/auth/users/{userId}',
    '/api/v1/auth/users/{userId}/role',
    '/api/v1/auth/users/{userId}/section',
    '/api/v1/auth/users/{userId}/status',
  ];
  check(
    'OpenAPI exposes Auth user-management endpoints',
    openApi.status === 200 && managerPaths.every((path) => Boolean(openApi.body?.paths?.[path])),
    { status: openApi.status },
  );

  const noToken = await request(gatewayUrl, '/api/v1/auth/users');
  check('Missing access token is rejected', noToken.status === 401, { status: noToken.status });

  const spoofed = await request(gatewayUrl, '/api/v1/auth/users', {
    headers: { 'x-user-id': '00000000-0000-0000-0000-000000000000', 'x-user-role': 'ADMIN' },
  });
  check('Spoofed identity headers are rejected', spoofed.status === 401, { status: spoofed.status });

  const admin = await register('admin');
  const target = await register('target');
  check('Test users registered', admin.status === 201 && target.status === 201, {
    admin: admin.status,
    target: target.status,
  });

  const refreshAsAccess = await request(gatewayUrl, '/api/v1/auth/users', {
    headers: { cookie: `accessToken=${cookieValue(target.cookies, 'refreshToken') || ''}` },
  });
  check('Gateway rejects HS256 refresh token on protected route', refreshAsAccess.status === 401, {
    status: refreshAsAccess.status,
  });

  const accessToken = cookieValue(target.cookies, 'accessToken') || '';
  const tokenParts = accessToken.split('.');
  if (tokenParts[2]) {
    tokenParts[2] = `${tokenParts[2][0] === 'A' ? 'B' : 'A'}${tokenParts[2].slice(1)}`;
  }
  const tamperedAccess = await request(gatewayUrl, '/api/v1/auth/users', {
    headers: { authorization: `Bearer ${tokenParts.join('.')}` },
  });
  check('Gateway rejects access token with tampered RS256 signature', tamperedAccess.status === 401, {
    status: tamperedAccess.status,
  });

  await prisma.user.update({
    where: { id: admin.user.id },
    data: { role: 'APP_MANAGER', version: { increment: 1 } },
  });

  const managerLogin = await request(gatewayUrl, '/api/v1/auth/login', {
    method: 'POST',
    json: { username: admin.username, password: 'ManagerTest-123!' },
  });
  check('Promoted app manager can log in with a current role claim', managerLogin.status === 200, { status: managerLogin.status });

  const regularAccess = await request(gatewayUrl, '/api/v1/auth/users', {
    headers: { cookie: target.cookies },
  });
  check('Non-admin user is rejected', regularAccess.status === 403, { status: regularAccess.status });

  const adminHeaders = { cookie: managerLogin.cookies };
  const list = await request(gatewayUrl, `/api/v1/auth/users?search=${encodeURIComponent(target.username)}`, {
    headers: adminHeaders,
  });
  check('Admin can list and search users',
    list.status === 200 && list.body?.data?.users?.some((user) => user.id === target.user.id),
    { status: list.status, count: list.body?.data?.users?.length });

  let detail = await request(gatewayUrl, `/api/v1/auth/users/${target.user.id}`, {
    headers: adminHeaders,
  });
  check('Admin can retrieve user detail', detail.status === 200, { status: detail.status });
  if (!detail.body?.data) {
    throw new Error(`User detail request failed: ${detail.status} ${JSON.stringify(detail.body)}`);
  }

  const roleUpdate = await request(gatewayUrl, `/api/v1/auth/users/${target.user.id}/role`, {
    method: 'PATCH',
    headers: adminHeaders,
    json: { role: 'APP_MANAGER', version: detail.body.data.version },
  });
  check('Admin can set user role', roleUpdate.status === 200 && roleUpdate.body?.data?.role === 'APP_MANAGER', {
    status: roleUpdate.status,
    role: roleUpdate.body?.data?.role,
  });

  const invalidSection = await request(gatewayUrl, `/api/v1/auth/users/${target.user.id}/section`, {
    method: 'PATCH',
    headers: adminHeaders,
    json: { section: 'INVALID_SECTION', version: roleUpdate.body.data.version },
  });
  check('Invalid section is rejected', invalidSection.status === 400, { status: invalidSection.status });

  const sectionVersion = roleUpdate.body.data.version;
  const sectionRace = await Promise.all([
    request(gatewayUrl, `/api/v1/auth/users/${target.user.id}/section`, {
      method: 'PATCH',
      headers: adminHeaders,
      json: { section: 'MARKETING', version: sectionVersion },
    }),
    request(gatewayUrl, `/api/v1/auth/users/${target.user.id}/section`, {
      method: 'PATCH',
      headers: adminHeaders,
      json: { section: 'ACCOUNTING', version: sectionVersion },
    }),
  ]);
  const sectionStatuses = sectionRace.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  check('Concurrent section update permits one winner',
    sectionStatuses[200] === 1 && sectionStatuses[409] === 1,
    sectionStatuses);

  detail = await request(gatewayUrl, `/api/v1/auth/users/${target.user.id}`, {
    headers: adminHeaders,
  });
  const deactivate = await request(gatewayUrl, `/api/v1/auth/users/${target.user.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    json: { isActive: false, version: detail.body.data.version },
  });
  check('Admin can deactivate user', deactivate.status === 200 && deactivate.body?.data?.isActive === false, {
    status: deactivate.status,
  });

  const inactiveMe = await request(gatewayUrl, '/api/v1/auth/me', {
    headers: { cookie: target.cookies },
  });
  check('Deactivated user access token is rejected by Auth Service', inactiveMe.status === 403, {
    status: inactiveMe.status,
  });

  const inactiveRefresh = await request(gatewayUrl, '/api/v1/auth/refresh-token', {
    method: 'POST',
    headers: { cookie: target.cookies },
  });
  check('Deactivated user refresh token is rejected', inactiveRefresh.status === 401 || inactiveRefresh.status === 403, {
    status: inactiveRefresh.status,
  });

  const selfRole = await request(gatewayUrl, `/api/v1/auth/users/${admin.user.id}`, {
    headers: adminHeaders,
  });
  const selfRoleUpdate = await request(gatewayUrl, `/api/v1/auth/users/${admin.user.id}/role`, {
    method: 'PATCH',
    headers: adminHeaders,
    json: { role: 'USER', version: selfRole.body.data.version },
  });
  check('Administrator cannot change own role', selfRoleUpdate.status === 409, {
    status: selfRoleUpdate.status,
  });

  const selfDeactivate = await request(gatewayUrl, `/api/v1/auth/users/${admin.user.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    json: { isActive: false, version: selfRole.body.data.version },
  });
  check('Administrator cannot deactivate own account', selfDeactivate.status === 409, {
    status: selfDeactivate.status,
  });

  const reactivate = await request(gatewayUrl, `/api/v1/auth/users/${target.user.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    json: { isActive: true, version: deactivate.body.data.version },
  });
  check('Admin can reactivate user', reactivate.status === 200 && reactivate.body?.data?.isActive === true, {
    status: reactivate.status,
  });

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const loginAfterReactivation = await request(gatewayUrl, '/api/v1/auth/login', {
    method: 'POST',
    json: { username: target.username, password: 'ManagerTest-123!' },
  });
  check('Reactivated user can log in again', loginAfterReactivation.status === 200, {
    status: loginAfterReactivation.status,
  });

  console.log(JSON.stringify({ runId, checks }, null, 2));
  if (checks.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  if (createdUsernames.length) {
    await prisma.user.deleteMany({ where: { normalizeUsername: { in: createdUsernames } } }).catch(() => undefined);
  }
  await prisma.$disconnect();
}
