const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { openApiDocument } = require('../../api-gateway/dist/docs/openapi.js');

const prefix = '/api/v1/fieldservice';
function inventory() {
  const root = path.resolve(__dirname, '../src');
  const index = readFileSync(path.join(root, 'routes/index.ts'), 'utf8');
  const imports = new Map([...index.matchAll(/import (\w+) from '([^']+\.routes\.js)'/g)].map(match => [match[1], match[2]]));
  const routes = [{ method: 'GET', path: '/health' }];
  const collect = (source, mount = '') => {
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)) {
      routes.push({ method: match[1].toUpperCase(), path: `${mount}${match[2] === '/' ? '' : match[2]}`.replace(/:([A-Za-z]+)/g, '{$1}') });
    }
  };
  collect(index);
  for (const match of index.matchAll(/router\.use\('([^']+)', (\w+)\)/g)) {
    assert.ok(imports.has(match[2]), `Unknown route mount ${match[2]}`);
    const file = path.resolve(root, 'routes', imports.get(match[2]).replace(/\.js$/, '.ts'));
    collect(readFileSync(file, 'utf8'), match[1]);
  }
  for (const file of ['user-sync/user-sync']) {
    collect(readFileSync(path.join(root, `modules/${file}.routes.ts`), 'utf8'));
  }
  return routes;
}

function resolve(schema) {
  return schema?.$ref ? schema.$ref.split('/').slice(1).reduce((value, key) => value[key], openApiDocument) : schema;
}
function validate(value, input, location = '$') {
  const schema = resolve(input);
  assert.ok(schema, `${location}: missing schema`);
  if (value === null && schema.nullable) return;
  for (const part of schema.allOf || []) validate(value, part, location);
  for (const keyword of ['oneOf', 'anyOf']) {
    if (schema[keyword]) {
      const matches = schema[keyword].filter(part => { try { validate(value, part, location); return true; } catch { return false; } }).length;
      assert.ok(keyword === 'oneOf' ? matches === 1 : matches >= 1, `${location}: ${keyword}`);
    }
  }
  if (schema.enum) assert.ok(schema.enum.includes(value), `${location}: enum ${JSON.stringify(value)}`);
  if (schema.type === 'object') {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${location}: object`);
    for (const key of schema.required || []) assert.ok(Object.hasOwn(value, key), `${location}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.additionalProperties === false) assert.ok(Object.hasOwn(schema.properties || {}, key), `${location}.${key}: unexpected`);
      if (schema.properties?.[key]) validate(item, schema.properties[key], `${location}.${key}`);
    }
    if (schema.minProperties) assert.ok(Object.keys(value).length >= schema.minProperties, `${location}: minProperties`);
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), `${location}: array`);
    value.forEach((item, index) => validate(item, schema.items, `${location}[${index}]`));
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, `${location}: minItems`);
    if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems, `${location}: maxItems`);
  } else if (schema.type === 'integer') assert.ok(Number.isInteger(value), `${location}: integer`);
  else if (schema.type) assert.equal(typeof value, schema.type, `${location}: type`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, `${location}: minLength`);
    if (schema.maxLength !== undefined) assert.ok(value.length <= schema.maxLength, `${location}: maxLength`);
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern), location);
    if (schema.format === 'uuid') assert.match(value, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i, location);
    if (schema.format === 'date-time') assert.ok(Number.isFinite(Date.parse(value)), `${location}: date-time`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, `${location}: minimum`);
    if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, `${location}: maximum`);
  }
}

function assertInventory() {
  const routes = inventory();
  const errors = [];
  const visited = new Set();
  const inspectReferences = node => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref && !visited.has(node.$ref)) {
      visited.add(node.$ref);
      let target;
      try { target = resolve(node); } catch { /* reported below */ }
      if (!target) errors.push(`Unresolved Swagger reference ${node.$ref}`);
      else inspectReferences(target);
    }
    for (const value of Object.values(node)) inspectReferences(value);
  };
  for (const route of routes) {
    const operation = openApiDocument.paths[`${prefix}${route.path}`]?.[route.method.toLowerCase()];
    if (!operation) errors.push(`Undocumented ${route.method} ${route.path}`);
    else inspectReferences(operation);
  }
  for (const [routePath, methods] of Object.entries(openApiDocument.paths)) {
    if (!routePath.startsWith(`${prefix}/`)) continue;
    for (const method of Object.keys(methods).filter(key => ['get', 'post', 'put', 'patch', 'delete'].includes(key))) {
      if (!routes.some(route => route.method.toLowerCase() === method && `${prefix}${route.path}` === routePath)) errors.push(`Unimplemented ${method.toUpperCase()} ${routePath}`);
    }
  }
  assert.deepEqual(errors, [], errors.join('\n'));
  return routes;
}
module.exports = { openApiDocument, prefix, inventory, assertInventory, resolve, validate };
if (require.main === module) console.log(`PASS: ${assertInventory().length} Field Service operations match Swagger in both directions.`);
