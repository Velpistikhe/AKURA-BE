import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, pred, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', 'tests'].includes(ent.name)) continue;
      walk(p, pred, out);
    } else if (pred(p)) out.push(p);
  }
  return out;
}

function scanServiceRoutes(service) {
  const src = path.join(root, service, 'src');
  if (!fs.existsSync(src)) return [];
  const files = walk(src, (p) => p.endsWith('.routes.ts'));
  const routes = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]/g;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      routes.push({
        service,
        method: m[1].toUpperCase(),
        path: m[2],
        file: path.relative(root, file).replace(/\\/g, '/'),
      });
    }
  }
  return routes;
}

function scanAppRoutes(service) {
  const appFile = path.join(root, service, 'src', 'app.ts');
  if (!fs.existsSync(appFile)) return [];
  const text = fs.readFileSync(appFile, 'utf8');
  const routes = [];
  const re = /app\.(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]/g;
  let m;
  while ((m = re.exec(text))) {
    routes.push({ service, method: m[1].toUpperCase(), path: m[2], file: path.relative(root, appFile).replace(/\\/g, '/') });
  }
  const mountRe = /app\.use\(\s*['"]([^'"]+)['"]/g;
  while ((m = mountRe.exec(text))) routes.push({ service, method: 'MOUNT', path: m[1], file: path.relative(root, appFile).replace(/\\/g, '/') });
  return routes;
}

function scanOpenApiPaths() {
  const docsDir = path.join(root, 'api-gateway', 'src', 'docs');
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.ts'));
  const pathKeys = new Set();
  const pathKeyPatterns = [
    /['"`](\/api\/[^'"`]+)['"`]\s*:/g,
    /['"`](\/api\/[^'"`]+)['"`]\s*=\s*\{/g,
  ];
  const opRe = /\b(get|post|put|patch|delete)\s*:/gi;
  let operations = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(docsDir, f), 'utf8');
    for (const re of pathKeyPatterns) {
      let m;
      while ((m = re.exec(text))) pathKeys.add(m[1]);
    }
    // catalog template root — expand known marketing prefixes
    if (f === 'catalog.ts' && text.includes('const root =')) {
      const expanded = text.replace(/\$\{root\}/g, '/api/v1/marketing');
      for (const re of pathKeyPatterns) {
        let m;
        while ((m = re.exec(expanded))) pathKeys.add(m[1]);
      }
    }
    while (opRe.exec(text)) operations += 1;
  }
  return { pathKeys: [...pathKeys].sort(), operations };
}

const services = ['auth-service', 'app-manager-service', 'marketing-service', 'finance-service', 'fieldservice-service'];
const implemented = [];
for (const svc of services) {
  implemented.push(...scanAppRoutes(svc), ...scanServiceRoutes(svc));
}

const { pathKeys: openapiPaths, operations } = scanOpenApiPaths();

console.log('IMPLEMENTED_COUNT', implemented.length);
console.log('OPENAPI_PATH_COUNT', openapiPaths.length, 'OPENAPI_OPERATIONS_EST', operations);
console.log('---OPENAPI---');
for (const p of openapiPaths) console.log(p);
console.log('---ROUTES---');
for (const r of implemented.sort((a, b) => a.service.localeCompare(b.service) || a.path.localeCompare(b.path))) {
  console.log(`${r.service}\t${r.method}\t${r.path}`);
}
