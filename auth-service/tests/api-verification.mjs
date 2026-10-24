import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const gatewayUrl = process.env.TEST_GATEWAY_URL || 'http://localhost:5000';
const authUrl = process.env.TEST_AUTH_URL || 'http://localhost:5001';

function readEnv(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1).replace(/^['"]|['"]$/g, '')];
      }),
  );
}

const localEnv = readEnv(new URL('../.env', import.meta.url));
const gatewaySecret = process.env.TEST_GATEWAY_SECRET || localEnv.GATEWAY_SECRET;
const prisma = new PrismaClient({ datasources: { db: { url: localEnv.DATABASE_URL } } });
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdUsernames = [];
const checks = [];
const loadResults = [];

function cookieJarFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';', 1)[0]).join('; ');
}

function cookieValue(cookieJar, name) {
  const match = cookieJar.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

function tokenCookiesCleared(cookieJar) {
  return /(?:^|;\s*)accessToken=(?:;|$)/.test(cookieJar)
    && /(?:^|;\s*)refreshToken=(?:;|$)/.test(cookieJar);
}

function decodeJwtPart(token, index) {
  return JSON.parse(Buffer.from(token.split('.')[index], 'base64url').toString('utf8'));
}

async function request(base, path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  const started = performance.now();
  try {
    const response = await fetch(`${base}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.json === undefined ? undefined : JSON.stringify(options.json),
      signal: AbortSignal.timeout(options.timeoutMs || 15_000),
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return {
      status: response.status,
      body,
      cookies: cookieJarFrom(response),
      durationMs: performance.now() - started,
    };
  } catch (error) {
    return { status: 0, error: error.message, cookies: '', durationMs: performance.now() - started };
  }
}

function check(name, passed, evidence) {
  checks.push({ name, passed, evidence });
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function runLoad(name, total, concurrency, operation) {
  let cursor = 0;
  const samples = [];
  const statuses = {};
  const started = performance.now();
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= total) return;
      const result = await operation(index);
      samples.push(result.durationMs);
      const key = result.status || 'error';
      statuses[key] = (statuses[key] || 0) + 1;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedMs = performance.now() - started;
  samples.sort((a, b) => a - b);
  loadResults.push({
    name,
    total,
    concurrency,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    requestsPerSecond: Number((total / (elapsedMs / 1000)).toFixed(1)),
    latencyMs: {
      min: Number((samples[0] || 0).toFixed(1)),
      p50: Number(percentile(samples, 0.50).toFixed(1)),
      p95: Number(percentile(samples, 0.95).toFixed(1)),
      p99: Number(percentile(samples, 0.99).toFixed(1)),
      max: Number((samples.at(-1) || 0).toFixed(1)),
    },
    statuses,
  });
}

const internalHeaders = { 'x-gateway-secret': gatewaySecret };

try {
  const gatewayHealth = await request(gatewayUrl, '/health');
  const directAuthHealth = await request(authUrl, '/health');
  const authHealth = await request(gatewayUrl, '/api/v1/auth/health');
  const directJwks = await request(authUrl, '/.well-known/jwks.json');
  const jwks = await request(gatewayUrl, '/api/v1/auth/.well-known/jwks.json');
  const openApi = await request(gatewayUrl, '/api-docs.json');
  check('Gateway health', gatewayHealth.status === 200, { status: gatewayHealth.status });
  check('Auth service rejects direct health access', directAuthHealth.status === 403, { status: directAuthHealth.status });
  check('Auth service health is available through Gateway', authHealth.status === 200, { status: authHealth.status });
  check(
    'Auth service rejects direct JWKS access without its gateway secret',
    directJwks.status === 403,
    { status: directJwks.status },
  );
  check(
    'Gateway publishes Auth RS256 JWKS without private key material',
    jwks.status === 200
      && jwks.body?.keys?.length === 1
      && jwks.body.keys[0].alg === 'RS256'
      && typeof jwks.body.keys[0].kid === 'string'
      && jwks.body.keys[0].d === undefined,
    { status: jwks.status, keyCount: jwks.body?.keys?.length },
  );
  check(
    'OpenAPI document exposes all auth endpoints',
    openApi.status === 200 && [
      '/api/v1/auth/register',
      '/api/v1/auth/.well-known/jwks.json',
      '/api/v1/auth/login',
      '/api/v1/auth/refresh-token',
      '/api/v1/auth/logout',
      '/api/v1/auth/me',
      '/api/v1/auth/profile',
      '/api/v1/auth/password',
    ].every((path) => Boolean(openApi.body?.paths?.[path])),
    { status: openApi.status },
  );

  const invalid = await request(gatewayUrl, '/api/v1/auth/register', {
    method: 'POST',
    json: { username: 'x', password: '1', firstName: '', lastName: '' },
  });
  check('Register validation rejects invalid payload', invalid.status === 400, { status: invalid.status });

  const mismatchedRegistration = await request(gatewayUrl, '/api/v1/auth/register', {
    method: 'POST',
    json: {
      username: `mismatch_${runId.replace(/[^a-z0-9]/gi, '').slice(-12)}`,
      password: 'TestPass-123!',
      passwordConfirmation: 'DifferentPass-123!',
      firstName: 'Mismatch',
      lastName: 'Test',
    },
  });
  check(
    'Register rejects a different password confirmation',
    mismatchedRegistration.status === 400
      && mismatchedRegistration.body?.message === 'Password dan konfirmasi password berbeda',
    { status: mismatchedRegistration.status, message: mismatchedRegistration.body?.message },
  );

  const functionalUsername = `func_${runId.replace(/[^a-z0-9]/gi, '').slice(-16)}`;
  createdUsernames.push(functionalUsername.toLowerCase());
  const functionalPassword = 'TestPass-123!';
  const registered = await request(gatewayUrl, '/api/v1/auth/register', {
    method: 'POST',
    json: {
      username: functionalUsername,
      password: functionalPassword,
      passwordConfirmation: functionalPassword,
      firstName: 'Functional',
      lastName: 'Test',
    },
  });
  const registeredUser = await prisma.user.findUnique({
    where: { normalizeUsername: functionalUsername.toLowerCase() },
  });
  const functionalUserId = registeredUser?.id;
  const registrationRefreshTokens = functionalUserId
    ? await prisma.refreshToken.count({ where: { userId: functionalUserId } })
    : -1;
  check(
    'Register creates a user without starting a token session',
    registered.status === 201
      && Boolean(functionalUserId)
      && !registered.cookies
      && registered.body?.data === undefined
      && registrationRefreshTokens === 0,
    {
      status: registered.status,
      cookies: registered.cookies,
      responseData: registered.body?.data,
      registrationRefreshTokens,
    },
  );
  const registrationHistory = functionalUserId
    ? await prisma.userHistory.findFirst({ where: { userId: functionalUserId }, orderBy: { version: 'asc' } })
    : null;
  check('Registration records CREATE history with a full snapshot and no password fields',
    registrationHistory?.action === 'CREATE'
      && registrationHistory.beforeSnapshot === null
      && registrationHistory.snapshot?.username === functionalUsername
      && !JSON.stringify(registrationHistory.snapshot).toLowerCase().includes('password')
      && registrationHistory.createdById === functionalUserId,
    { action: registrationHistory?.action, beforeSnapshot: registrationHistory?.beforeSnapshot });

  const initialLogin = await request(gatewayUrl, '/api/v1/auth/login', {
    method: 'POST',
    json: { username: functionalUsername, password: functionalPassword },
  });
  const functionalCookies = initialLogin.cookies;
  check('Login starts a token session after registration', initialLogin.status === 200 && Boolean(functionalCookies), {
    status: initialLogin.status,
  });
  const bodyAccessToken = initialLogin.body?.data?.accessToken;
  check(
    'Login returns the access token in the response body alongside the HttpOnly cookie',
    typeof bodyAccessToken === 'string' && bodyAccessToken.length > 0 && bodyAccessToken === cookieValue(functionalCookies, 'accessToken'),
    { dataType: typeof bodyAccessToken, matchesCookie: bodyAccessToken === cookieValue(functionalCookies, 'accessToken') },
  );
  check(
    'Login never returns the refresh token in the response body',
    initialLogin.body?.data?.refreshToken === undefined,
    { keys: initialLogin.body?.data ? Object.keys(initialLogin.body.data) : null },
  );

  const accessToken = cookieValue(functionalCookies, 'accessToken');
  const accessHeader = accessToken ? decodeJwtPart(accessToken, 0) : {};
  const accessPayload = accessToken ? decodeJwtPart(accessToken, 1) : {};
  check(
    'Access token uses RS256, kid, issuer, audience, subject, and access type',
    accessHeader.alg === 'RS256'
      && typeof accessHeader.kid === 'string'
      && accessPayload.sub === functionalUserId
      && accessPayload.name === 'Functional Test'
      && accessPayload.iss === (localEnv.JWT_ISSUER || 'akura-auth')
      && accessPayload.aud === (localEnv.JWT_AUDIENCE || 'akura-api')
      && accessPayload.officeBranchId === null
      && accessPayload.type === 'access',
    { alg: accessHeader.alg, kid: accessHeader.kid, sub: accessPayload.sub },
  );

  const unauthorizedMe = await request(gatewayUrl, '/api/v1/auth/me');
  check('Protected route rejects missing credentials', unauthorizedMe.status === 401, { status: unauthorizedMe.status });

  const me = await request(gatewayUrl, '/api/v1/auth/me', { headers: { cookie: functionalCookies } });
  check('Get profile with access cookie', me.status === 200 && me.body?.data?.id === functionalUserId, { status: me.status });
  check(
    'Profile exposes branch name alongside officeBranchId',
    me.status === 200
      && Object.hasOwn(me.body?.data ?? {}, 'branch')
      && me.body?.data?.branch === null
      && me.body?.data?.officeBranchId === null,
    { branch: me.body?.data?.branch, officeBranchId: me.body?.data?.officeBranchId },
  );

  const refreshAsAccess = await request(gatewayUrl, '/api/v1/auth/me', {
    headers: { cookie: `accessToken=${cookieValue(functionalCookies, 'refreshToken') || ''}` },
  });
  check('Protected route rejects refresh token as access token', refreshAsAccess.status === 401, {
    status: refreshAsAccess.status,
  });

  const spoofedMe = await request(gatewayUrl, '/api/v1/auth/me', {
    headers: { 'x-user-id': functionalUserId || '00000000-0000-0000-0000-000000000000' },
  });
  check('Gateway must reject spoofed x-user-id without credentials', spoofedMe.status === 401, {
    status: spoofedMe.status,
    securityImpact: spoofedMe.status === 200 ? 'authentication bypass' : undefined,
  });

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const badLogin = await request(gatewayUrl, '/api/v1/auth/login', {
    method: 'POST',
    json: { username: functionalUsername, password: 'wrong-password' },
  });
  check('Login rejects incorrect password', badLogin.status === 401, { status: badLogin.status });

  const goodLogin = await request(gatewayUrl, '/api/v1/auth/login', {
    method: 'POST',
    json: { username: functionalUsername, password: functionalPassword },
  });
  check('Login accepts correct password', goodLogin.status === 200 && Boolean(goodLogin.cookies), { status: goodLogin.status });

  const idleRefreshToken = cookieValue(goodLogin.cookies, 'refreshToken');
  const bodyOnlyRefresh = idleRefreshToken
    ? await request(gatewayUrl, '/api/v1/auth/refresh-token', {
      method: 'POST', json: { refreshToken: idleRefreshToken },
    })
    : { status: 0 };
  check('Refresh token body transport is rejected', bodyOnlyRefresh.status === 400, {
    status: bodyOnlyRefresh.status,
    message: bodyOnlyRefresh.body?.message,
  });
  const bodyOnlyLogout = idleRefreshToken
    ? await request(gatewayUrl, '/api/v1/auth/logout', {
      method: 'POST', json: { refreshToken: idleRefreshToken },
    })
    : { status: 0 };
  const tokenAfterBodyOnlyLogout = idleRefreshToken
    ? await prisma.refreshToken.findUnique({ where: { token: idleRefreshToken } })
    : null;
  check('Logout ignores refresh token in request body',
    bodyOnlyLogout.status === 200 && tokenAfterBodyOnlyLogout?.isRevoked === false,
    { status: bodyOnlyLogout.status, isRevoked: tokenAfterBodyOnlyLogout?.isRevoked });
  const idleMinutes = Number(localEnv.JWT_REFRESH_IDLE_TIMEOUT_MINUTES || 60);
  if (idleRefreshToken) {
    await prisma.refreshToken.update({
      where: { token: idleRefreshToken },
      data: { lastActivityAt: new Date(Date.now() - (idleMinutes + 1) * 60 * 1_000) },
    });
  }
  const idleRefresh = idleRefreshToken
    ? await request(gatewayUrl, '/api/v1/auth/refresh-token', {
      method: 'POST', headers: { 'x-refresh-token': idleRefreshToken },
    })
    : { status: 0 };
  check(
    'Refresh token idle beyond the configured limit is rejected',
    idleRefresh.status === 401
      && idleRefresh.body?.message?.includes('inactivity')
      && tokenCookiesCleared(idleRefresh.cookies),
    { status: idleRefresh.status, message: idleRefresh.body?.message, idleMinutes, cookiesCleared: tokenCookiesCleared(idleRefresh.cookies || '') },
  );

  const expiredLogin = await request(gatewayUrl, '/api/v1/auth/login', {
    method: 'POST', json: { username: functionalUsername, password: functionalPassword },
  });
  const expiredRefreshToken = cookieValue(expiredLogin.cookies, 'refreshToken');
  if (expiredRefreshToken) {
    await prisma.refreshToken.update({
      where: { token: expiredRefreshToken },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
  }
  const expiredRefresh = expiredRefreshToken
    ? await request(gatewayUrl, '/api/v1/auth/refresh-token', {
      method: 'POST', headers: { 'x-refresh-token': expiredRefreshToken },
    })
    : { status: 0, cookies: '' };
  const expiredTokenRow = expiredRefreshToken
    ? await prisma.refreshToken.findUnique({ where: { token: expiredRefreshToken } })
    : null;
  check('Expired refresh token is revoked and clears both token cookies',
    expiredRefresh.status === 401
      && Boolean(expiredTokenRow?.isRevoked)
      && tokenCookiesCleared(expiredRefresh.cookies),
    {
      status: expiredRefresh.status,
      isRevoked: expiredTokenRow?.isRevoked,
      cookiesCleared: tokenCookiesCleared(expiredRefresh.cookies || ''),
    });

  const jwtExpiredRefreshToken = jwt.sign(
    { id: randomUUID(), sub: functionalUserId, type: 'refresh' },
    localEnv.JWT_REFRESH_SECRET,
    { expiresIn: -1 },
  );
  await prisma.refreshToken.create({
    data: {
      userId: functionalUserId,
      token: jwtExpiredRefreshToken,
      expiresAt: new Date(Date.now() + 60_000),
      familyId: randomUUID(),
    },
  });
  const jwtExpiredRefresh = await request(gatewayUrl, '/api/v1/auth/refresh-token', {
    method: 'POST', headers: { 'x-refresh-token': jwtExpiredRefreshToken },
  });
  const jwtExpiredTokenRow = await prisma.refreshToken.findUnique({
    where: { token: jwtExpiredRefreshToken },
  });
  check('JWT-expired refresh token is revoked and clears both token cookies',
    jwtExpiredRefresh.status === 401
      && Boolean(jwtExpiredTokenRow?.isRevoked)
      && tokenCookiesCleared(jwtExpiredRefresh.cookies),
    {
      status: jwtExpiredRefresh.status,
      isRevoked: jwtExpiredTokenRow?.isRevoked,
      cookiesCleared: tokenCookiesCleared(jwtExpiredRefresh.cookies || ''),
    });

  const raceUsername = `race_${runId.replace(/[^a-z0-9]/gi, '').slice(-16)}`;
  createdUsernames.push(raceUsername.toLowerCase());
  const racePayload = {
    username: raceUsername,
    password: 'RacePass-123!',
    passwordConfirmation: 'RacePass-123!',
    firstName: 'Register',
    lastName: 'Race',
  };
  const registerRace = await Promise.all(Array.from({ length: 12 }, () => request(authUrl, '/register', {
    method: 'POST', headers: internalHeaders, json: racePayload,
  })));
  const registerStatuses = registerRace.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  check('Concurrent duplicate registration creates exactly one user', registerStatuses[201] === 1 && registerStatuses[409] === 11, registerStatuses);

  const raceLogin = await request(authUrl, '/login', {
    method: 'POST',
    headers: internalHeaders,
    json: { username: raceUsername, password: racePayload.password },
  });
  const raceCookies = raceLogin.cookies;
  check('Login starts the race-test token session', raceLogin.status === 200 && Boolean(raceCookies), {
    status: raceLogin.status,
  });
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const refreshRace = await Promise.all(Array.from({ length: 3 }, () => request(authUrl, '/refresh-token', {
    method: 'POST',
    headers: { ...internalHeaders, cookie: raceCookies },
  })));
  const refreshStatuses = refreshRace.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  const refreshWinner = refreshRace.find((result) => result.status === 200);
  check(
    'Successful refresh returns the rotated access token without exposing refresh token',
    refreshWinner?.body?.data?.accessToken
      && refreshWinner.body.data.refreshToken === undefined
      && refreshWinner.body.data.accessToken === cookieValue(refreshWinner.cookies, 'accessToken'),
    { status: refreshWinner?.status, hasAccessToken: Boolean(refreshWinner?.body?.data?.accessToken), hasRefreshToken: Boolean(refreshWinner?.body?.data?.refreshToken) },
  );
  const rejectedRefreshes = refreshRace.filter((result) => result.status === 401);
  check('Concurrent refresh allows the old token only once and clears rejected cookies',
    refreshStatuses[200] === 1
      && refreshStatuses[401] === 2
      && rejectedRefreshes.every((result) => tokenCookiesCleared(result.cookies)),
    { ...refreshStatuses, rejectedCookiesCleared: rejectedRefreshes.every((result) => tokenCookiesCleared(result.cookies)) });

  const winnerRefreshToken = cookieValue(refreshWinner?.cookies || '', 'refreshToken');
  const usedRaceRefreshToken = cookieValue(raceCookies, 'refreshToken');
  const [usedTokenRow, newTokenRow] = await Promise.all([
    usedRaceRefreshToken ? prisma.refreshToken.findUnique({ where: { token: usedRaceRefreshToken } }) : null,
    winnerRefreshToken ? prisma.refreshToken.findUnique({ where: { token: winnerRefreshToken } }) : null,
  ]);
  check(
    'Successful refresh records last activity on old and rotated tokens',
    Boolean(usedTokenRow?.isRevoked)
      && Boolean(usedTokenRow?.lastActivityAt)
      && Boolean(newTokenRow?.lastActivityAt)
      && Math.abs(usedTokenRow.lastActivityAt.getTime() - newTokenRow.lastActivityAt.getTime()) < 1_000,
    {
      usedLastActivityAt: usedTokenRow?.lastActivityAt,
      newLastActivityAt: newTokenRow?.lastActivityAt,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const familyRevocationProbe = winnerRefreshToken
    ? await request(authUrl, '/refresh-token', {
      method: 'POST', headers: { ...internalHeaders, 'x-refresh-token': winnerRefreshToken },
    })
    : { status: 0 };
  check('Refresh-token reuse revokes the entire token family and clears cookies',
    familyRevocationProbe.status === 401 && tokenCookiesCleared(familyRevocationProbe.cookies), {
    statusAfterReuseDetection: familyRevocationProbe.status,
    cookiesCleared: tokenCookiesCleared(familyRevocationProbe.cookies || ''),
    securityImpact: familyRevocationProbe.status === 200 ? 'new token remained usable' : undefined,
  });

  const profileBefore = await request(authUrl, '/me', { headers: { ...internalHeaders, cookie: raceCookies } });
  const startingVersion = profileBefore.body?.data?.version;
  const profileRace = await Promise.all(Array.from({ length: 10 }, (_, index) => request(authUrl, '/profile', {
    method: 'PUT',
    headers: { ...internalHeaders, cookie: raceCookies },
    json: { firstName: 'Concurrent', lastName: `Profile ${index}` },
  })));
  const profileAfter = await request(authUrl, '/me', { headers: { ...internalHeaders, cookie: raceCookies } });
  const profileSuccesses = profileRace.filter((result) => result.status === 200).length;
  check('Concurrent profile updates avoid lost versions',
    profileSuccesses === 10 && profileAfter.body?.data?.version === startingVersion + 10,
    { successes: profileSuccesses, startingVersion, finalVersion: profileAfter.body?.data?.version });

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const concurrentLogins = await Promise.all(Array.from({ length: 12 }, () => request(authUrl, '/login', {
    method: 'POST', headers: internalHeaders, json: { username: raceUsername, password: racePayload.password },
  })));
  const loginStatuses = concurrentLogins.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  check('Concurrent valid logins all succeed', loginStatuses[200] === 12, loginStatuses);

  const mismatchedPasswordChange = await request(authUrl, '/password', {
    method: 'PUT',
    headers: { ...internalHeaders, cookie: raceCookies },
    json: {
      oldPassword: racePayload.password,
      newPassword: 'Mismatch-New-456!',
      newPasswordConfirmation: 'Different-New-789!',
    },
  });
  check(
    'Password change rejects a different new-password confirmation',
    mismatchedPasswordChange.status === 400
      && mismatchedPasswordChange.body?.message === 'Password baru dan konfirmasi password baru berbeda',
    { status: mismatchedPasswordChange.status, message: mismatchedPasswordChange.body?.message },
  );

  const passwordRace = await Promise.all([
    request(authUrl, '/password', {
      method: 'PUT',
      headers: { ...internalHeaders, cookie: raceCookies },
      json: {
        oldPassword: racePayload.password,
        newPassword: 'RaceWinner-A-456!',
        newPasswordConfirmation: 'RaceWinner-A-456!',
      },
    }),
    request(authUrl, '/password', {
      method: 'PUT',
      headers: { ...internalHeaders, cookie: raceCookies },
      json: {
        oldPassword: racePayload.password,
        newPassword: 'RaceWinner-B-789!',
        newPasswordConfirmation: 'RaceWinner-B-789!',
      },
    }),
  ]);
  const passwordStatuses = passwordRace.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  check('Concurrent password changes permit exactly one winner',
    passwordStatuses[200] === 1 && passwordStatuses[400] === 1,
    passwordStatuses);

  await runLoad('auth health through Gateway', 1000, 50, () => request(gatewayUrl, '/api/v1/auth/health', { timeoutMs: 10_000 }));
  await runLoad('authenticated profile read', 300, 30, () => request(authUrl, '/me', {
    headers: { ...internalHeaders, cookie: raceCookies }, timeoutMs: 10_000,
  }));
  await runLoad('gateway health with global rate limiter', 150, 25, () => request(gatewayUrl, '/health', { timeoutMs: 10_000 }));

  const rateResult = loadResults.at(-1);
  check('Gateway rate limiter returns 429 under excess load', Boolean(rateResult.statuses[429]), rateResult.statuses);

  if (checks.some((result) => !result.passed)) process.exitCode = 1;
  console.log(JSON.stringify({ runId, checks, loadResults }, null, 2));
} finally {
  if (createdUsernames.length) {
    await prisma.user.deleteMany({ where: { normalizeUsername: { in: createdUsernames } } }).catch(() => {});
  }
  await prisma.$disconnect();
}
