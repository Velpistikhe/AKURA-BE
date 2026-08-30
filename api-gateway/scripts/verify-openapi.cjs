const { openApiDocument } = require('../dist/docs/openapi.js');

const expectedOperations = [
  'GET /health',
  'GET /services',
  'GET /api-docs.json',
  'POST /api/v1/auth/register',
  'GET /api/v1/auth/.well-known/jwks.json',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh-token',
  'POST /api/v1/auth/logout',
  'GET /api/v1/auth/me',
  'PUT /api/v1/auth/profile',
  'PUT /api/v1/auth/password',
  'GET /api/v1/auth/users',
  'GET /api/v1/auth/users/{userId}',
  'PATCH /api/v1/auth/users/{userId}/role',
  'PATCH /api/v1/auth/users/{userId}/section',
  'PATCH /api/v1/auth/users/{userId}/status',
  'GET /api/v1/app-manager/menus/my-menus',
  'GET /api/v1/app-manager/menus',
  'POST /api/v1/app-manager/menus',
  'GET /api/v1/app-manager/menus/{menuId}',
  'PATCH /api/v1/app-manager/menus/{menuId}',
  'DELETE /api/v1/app-manager/menus/{menuId}',
  'GET /api/v1/app-manager/menu-items',
  'POST /api/v1/app-manager/menu-items',
  'GET /api/v1/app-manager/menu-items/{menuItemId}',
  'PATCH /api/v1/app-manager/menu-items/{menuItemId}',
  'DELETE /api/v1/app-manager/menu-items/{menuItemId}',
  'GET /api/v1/app-manager/menu-accesses',
  'POST /api/v1/app-manager/menu-accesses',
  'GET /api/v1/app-manager/menu-accesses/{menuAccessId}',
  'PATCH /api/v1/app-manager/menu-accesses/{menuAccessId}',
  'DELETE /api/v1/app-manager/menu-accesses/{menuAccessId}',
  'GET /api/v1/marketing/companies',
  'POST /api/v1/marketing/companies',
  'GET /api/v1/marketing/companies/{companyId}',
  'PATCH /api/v1/marketing/companies/{companyId}',
  'DELETE /api/v1/marketing/companies/{companyId}',
  'GET /api/v1/marketing/company-staffs',
  'POST /api/v1/marketing/company-staffs',
  'GET /api/v1/marketing/company-staffs/{companyStaffId}',
  'PATCH /api/v1/marketing/company-staffs/{companyStaffId}',
  'DELETE /api/v1/marketing/company-staffs/{companyStaffId}',
  'GET /api/v1/marketing/services',
  'POST /api/v1/marketing/services',
  'GET /api/v1/marketing/services/{serviceId}',
  'DELETE /api/v1/marketing/services/{serviceId}',
  'POST /api/v1/marketing/services/{serviceId}/scopes',
  'DELETE /api/v1/marketing/services/{serviceId}/scopes/{scopeId}',
  'POST /api/v1/marketing/services/{serviceId}/maintenance',
  'POST /api/v1/marketing/services/{serviceId}/maintenance/scopes',
  'DELETE /api/v1/marketing/services/{serviceId}/maintenance/scopes/{scopeId}',
  'GET /api/v1/marketing/items',
  'POST /api/v1/marketing/items',
  'GET /api/v1/marketing/items/{itemId}',
  'PATCH /api/v1/marketing/items/{itemId}',
  'DELETE /api/v1/marketing/items/{itemId}',
];

const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const actualOperations = Object.entries(openApiDocument.paths).flatMap(([path, pathItem]) =>
  Object.keys(pathItem)
    .filter((method) => httpMethods.has(method))
    .map((method) => `${method.toUpperCase()} ${path}`),
);

const missing = expectedOperations.filter((operation) => !actualOperations.includes(operation));
const extra = actualOperations.filter((operation) => !expectedOperations.includes(operation));
const references = new Set();

const collectReferences = (value) => {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') references.add(value.$ref);
  Object.values(value).forEach(collectReferences);
};

collectReferences(openApiDocument);

const brokenReferences = [...references].filter((reference) => {
  const parts = reference.replace(/^#\//, '').split('/');
  return parts.reduce((value, part) => value?.[part], openApiDocument) === undefined;
});

if (missing.length || extra.length || brokenReferences.length) {
  console.error(JSON.stringify({ missing, extra, brokenReferences }, null, 2));
  process.exit(1);
}

console.log(`OpenAPI verified: ${actualOperations.length} operations and ${references.size} references.`);
