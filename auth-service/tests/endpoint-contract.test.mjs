import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();
const base = process.env.TEST_GATEWAY_URL || 'http://localhost:5000';
const prefix = '/api/v1/auth';
const password = 'Contract-Test-123!';
const runId = `contract_${Date.now()}`;
const userIds = [];
const covered = new Set();
let checks = 0;
let document;

// Validate the response constraints used by Auth's OpenAPI schemas, including
// nested references. Request validation is exercised with real HTTP requests.
function validate(value, schema, path = '$') {
  if (!schema) return;
  if (schema.$ref) return validate(value, schema.$ref.split('/').slice(1).reduce((item, key) => item[key], document), path);
  if (value === null && schema.nullable) return;
  for (const part of schema.allOf || []) validate(value, part, path);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${path}: enum`);
  if (schema.type === 'object') {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${path}: object`);
    for (const key of schema.required || []) assert.ok(Object.hasOwn(value, key), `${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.additionalProperties === false) assert.ok(Object.hasOwn(schema.properties || {}, key), `${path}.${key}: unexpected`);
      if (schema.properties?.[key]) validate(item, schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), `${path}: array`);
    value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`));
  } else if (schema.type === 'integer') assert.ok(Number.isInteger(value), `${path}: integer`);
  else if (schema.type) assert.equal(typeof value, schema.type, `${path}: type`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, `${path}: minimum`);
    if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, `${path}: maximum`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, `${path}: minLength`);
    if (schema.maxLength !== undefined) assert.ok(value.length <= schema.maxLength, `${path}: maxLength`);
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern), path);
    if (schema.format === 'uuid') assert.match(value, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i, path);
    if (schema.format === 'date-time') assert.ok(Number.isFinite(Date.parse(value)), `${path}: date-time`);
    if (schema.format === 'email') assert.match(value, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, path);
  }
}

async function request(method, path, expected, { token, json, headers = {} } = {}) {
  const response = await fetch(`${base}${prefix}${path}`, {
    method, headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(json ? { 'content-type': 'application/json' } : {}) },
    body: json === undefined ? undefined : JSON.stringify(json), signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
  const exactPath = `${prefix}${path.split('?')[0]}`;
  const template = document.paths[exactPath] ? exactPath : Object.keys(document.paths).find(key => {
    const pattern = key.replace(/\{[^}]+\}/g, '[^/]+');
    return new RegExp(`^${pattern}$`).test(`${prefix}${path.split('?')[0]}`);
  });
  assert.ok(template, `${path}: documented path`);
  const operation = document.paths[template][method.toLowerCase()];
  assert.ok(operation, `${method} ${template}: documented method`);
  const schema = operation.responses[expected]?.content?.['application/json']?.schema;
  assert.ok(schema, `${method} ${path}: documented ${expected} response schema`);
  validate(body, schema);
  if (expected < 300) covered.add(`${method} ${template}`);
  checks++;
  return { body, response };
}

async function createUser(suffix, assignment = {}) {
  const username = `${runId}_${suffix}`;
  await request('POST', '/register', 201, { json: { username, password, passwordConfirmation: password, firstName: 'Contract', lastName: suffix } });
  const user = await prisma.user.findUniqueOrThrow({ where: { normalizeUsername: username } });
  userIds.push(user.id);
  await prisma.user.update({ where: { id: user.id }, data: assignment });
  const login = await request('POST', '/login', 200, { json: { username, password } });
  return { id: user.id, username, token: login.body.data.accessToken, cookies: login.response.headers.getSetCookie() };
}

try {
  const response = await fetch(`${base}/api-docs.json`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  document = await response.json();
  for (const name of ['RegisterRequest', 'UpdateProfileRequest', 'UpdateUserRequest']) {
    assert.equal(document.components.schemas[name].properties.telp.minLength, 1, `${name}: non-null telephone must not be empty`);
  }
  // Route inventory is derived from source, so a newly added endpoint cannot
  // silently escape this coverage check.
  const inventory = [['GET', '/health'], ['GET', '/.well-known/jwks.json']];
  for (const [file, mount] of [['auth/auth.routes.ts', ''], ['user-management/user-management.routes.ts', '/users']]) {
    const source = readFileSync(new URL(`../src/modules/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)) {
      inventory.push([match[1].toUpperCase(), `${mount}${match[2] === '/' ? '' : match[2]}`.replace(/:([A-Za-z]+)/g, '{$1}')]);
    }
  }
  await request('GET', '/health', 200);
  await request('GET', '/.well-known/jwks.json', 200);
  const branchA = randomUUID(), branchB = randomUUID();
  const manager = await createUser('manager', { role: 'APP_MANAGER', officeBranchId: branchA, officeBranchName: 'Contract A' });
  const actor = await createUser('actor', { officeBranchId: branchA, officeBranchName: 'Contract A' });
  const inspector = await createUser('inspector', { section: 'FIELD_SERVICE', officeBranchId: branchA, officeBranchName: 'Contract A' });
  const contact = await createUser('contact', { role: 'ADMIN', section: 'MARKETING', officeBranchId: branchA, officeBranchName: 'Contract A', email: 'contact@example.com', telp: '+628123456' });
  const foreign = await createUser('foreign', { role: 'ADMIN', section: 'MARKETING', officeBranchId: branchB, officeBranchName: 'Contract B' });
  const branchless = await createUser('branchless');

  const protectedRoutes = [['GET', '/me'], ['PUT', '/profile'], ['PUT', '/password'], ['GET', '/users'], ['GET', `/users/${actor.id}`], ['PATCH', `/users/${actor.id}`], ['GET', '/users/marketing-contacts'], ['GET', `/users/field-service/inspectors?ids=${inspector.id}`], ['GET', '/users/sync/deliveries']];
  for (const [method, path] of protectedRoutes) await request(method, path, 401);
  for (const [method, path] of protectedRoutes.filter(([, path]) => path === '/users' || path.includes(actor.id) || path.includes('/sync/'))) {
    await request(method, path, 403, { token: actor.token });
  }
  await request('GET', '/me', 401, { token: 'invalid-token' });
  await request('GET', '/me', 200, { token: actor.token });
  await request('GET', '/me', 200, { headers: { cookie: actor.cookies.map(value => value.split(';')[0]).join('; ') } });
  await request('POST', '/login', 400, { json: {} });
  await request('POST', '/login', 401, { json: { username: actor.username, password: 'wrong' } });
  await request('POST', '/register', 400, { json: { username: 'x', password: 'x' } });
  await request('POST', '/register', 409, { json: { username: actor.username.toUpperCase(), password, passwordConfirmation: password, firstName: 'Duplicate', lastName: 'Test' } });
  await request('PUT', '/profile', 400, { token: actor.token, json: { firstName: '' } });
  await request('PUT', '/profile', 400, { token: actor.token, json: { firstName: 'Contract', lastName: 'Actor', telp: '' } });
  const profile = await request('PUT', '/profile', 200, { token: actor.token, json: { firstName: 'Updated', lastName: 'Actor', email: '  ACTOR@EXAMPLE.COM ', telp: '+628123456' } });
  assert.equal(profile.body.data.email, 'actor@example.com');
  assert.equal(profile.body.data.officeBranchId, branchA);
  const cleared = await request('PUT', '/profile', 200, { token: actor.token, json: { firstName: 'Updated', lastName: 'Actor', email: null, telp: null } });
  assert.equal(cleared.body.data.email, null);
  assert.equal(cleared.body.data.telp, null);

  const contacts = await request('GET', `/users/marketing-contacts?officeBranchId=${branchB}`, 200, { token: actor.token });
  assert.deepEqual(contacts.body.data.contacts.map(item => item.name), ['Contract contact']);
  assert.deepEqual((await request('GET', '/users/marketing-contacts', 200, { token: branchless.token })).body.data.contacts, []);
  const inspectors = await request('GET', `/users/field-service/inspectors?ids=${inspector.id},${foreign.id},${contact.id}`, 200, { token: actor.token });
  assert.deepEqual(inspectors.body.data.inspectors, [{ id: inspector.id, name: 'Contract inspector' }]);
  assert.deepEqual((await request('GET', `/users/field-service/inspectors?ids=${inspector.id}`, 200, { token: branchless.token })).body.data.inspectors, []);
  await request('GET', '/users/field-service/inspectors?ids=invalid', 400, { token: actor.token });
  await request('GET', `/users/field-service/inspectors?ids=${inspector.id}&officeBranchId=${branchB}`, 400, { token: actor.token });
  await request('GET', `/users?officeBranchId=${branchA}&search=${runId}`, 200, { token: manager.token });
  await request('GET', '/users?limit=101', 400, { token: manager.token });
  await request('GET', `/users/${actor.id}`, 200, { token: manager.token });
  await request('GET', '/users/invalid', 400, { token: manager.token });
  await request('GET', `/users/${randomUUID()}`, 404, { token: manager.token });
  await request('GET', `/users/sync/deliveries?userId=${actor.id}`, 200, { token: manager.token });
  await request('GET', '/users/sync/deliveries?targetService=invalid', 400, { token: manager.token });
  const current = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  await request('PATCH', `/users/${actor.id}`, 400, { token: manager.token, json: { version: current.version, officeBranchId: branchB } });
  const update = await request('PATCH', `/users/${actor.id}`, 200, { token: manager.token, json: { version: current.version, officeBranchId: branchB, branch: 'Contract B' } });
  assert.equal(update.body.data.officeBranchId, branchB);
  await request('PATCH', `/users/${actor.id}`, 409, { token: manager.token, json: { version: current.version, email: 'stale@example.com' } });
  // A pre-existing token must use the new database branch assignment.
  assert.deepEqual((await request('GET', '/users/marketing-contacts', 200, { token: actor.token })).body.data.contacts.map(item => item.name), ['Contract foreign']);
  await request('PATCH', `/users/${manager.id}`, 409, { token: manager.token, json: { version: 1, role: 'USER' } });

  await request('POST', '/refresh-token', 400);
  await request('POST', '/refresh-token', 401, { headers: { 'x-refresh-token': 'invalid' } });
  const refreshToken = actor.cookies.find(value => value.startsWith('refreshToken=')).split(';')[0].slice('refreshToken='.length);
  await request('POST', '/refresh-token', 200, { headers: { 'x-refresh-token': refreshToken } });
  await request('POST', '/logout', 200, { headers: { cookie: contact.cookies.map(value => value.split(';')[0]).join('; ') } });
  const contactRefresh = contact.cookies.find(value => value.startsWith('refreshToken=')).split(';')[0].slice('refreshToken='.length);
  assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { token: contactRefresh } })).isRevoked, true);
  await request('POST', '/logout', 200);
  await request('PUT', '/password', 400, { token: actor.token, json: { oldPassword: 'wrong', newPassword: password, newPasswordConfirmation: password } });
  await request('PUT', '/password', 200, { token: actor.token, json: { oldPassword: password, newPassword: 'New-Contract-456!', newPasswordConfirmation: 'New-Contract-456!' } });
  assert.equal(await prisma.refreshToken.count({ where: { userId: actor.id, isRevoked: false } }), 0);
  await request('POST', '/login', 401, { json: { username: actor.username, password } });
  await request('POST', '/login', 200, { json: { username: actor.username, password: 'New-Contract-456!' } });
  await prisma.user.update({ where: { id: foreign.id }, data: { isActive: false } });
  await request('GET', '/me', 403, { token: foreign.token });
  await request('POST', '/login', 403, { json: { username: foreign.username, password } });

  for (const [method, path] of inventory) assert.ok(covered.has(`${method} ${prefix}${path}`), `Missing successful coverage: ${method} ${path}`);
  console.log(`PASS: ${checks} HTTP contract checks; all ${inventory.length} Auth operations covered; branch isolation and authorization verified.`);
} finally {
  // Delete only fixtures from this run, including outbox children with Restrict.
  try {
    if (userIds.length) {
      await prisma.$transaction(async tx => {
        await tx.userSyncDelivery.deleteMany({ where: { event: { userId: { in: userIds } } } });
        await tx.userSyncEvent.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
