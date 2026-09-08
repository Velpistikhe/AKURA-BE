const { openApiDocument } = require('../dist/docs/openapi.js');

const expectedOperations = [
  'GET /health',
  'GET /api/v1/auth/health',
  'GET /api/v1/app-manager/health',
  'GET /api/v1/marketing/health',
  'GET /services',
  'GET /api-docs',
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
  'PATCH /api/v1/auth/users/{userId}',
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
  'GET /api/v1/app-manager/office-branches',
  'POST /api/v1/app-manager/office-branches',
  'GET /api/v1/app-manager/office-branches/options',
  'GET /api/v1/app-manager/office-branches/{officeBranchId}',
  'PATCH /api/v1/app-manager/office-branches/{officeBranchId}',
  'DELETE /api/v1/app-manager/office-branches/{officeBranchId}',
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
  'PATCH /api/v1/marketing/services/{serviceId}',
  'DELETE /api/v1/marketing/services/{serviceId}',
  'POST /api/v1/marketing/services/{serviceId}/scopes',
  'DELETE /api/v1/marketing/services/{serviceId}/scopes/{scopeId}',
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

const expectedListContracts = {
  '/api/v1/auth/users': {
    filters: ['search', 'role', 'section', 'officeBranchId', 'isActive'],
    sorts: ['username', 'firstName', 'lastName', 'role', 'section', 'officeBranchId', 'isActive', 'updatedAt'],
    defaultLimit: 20,
  },
  '/api/v1/app-manager/menus': {
    filters: ['search', 'hasItem', 'isActive'],
    sorts: ['key', 'label', 'hasItem', 'order', 'isActive', 'updatedAt'],
    defaultLimit: 20,
  },
  '/api/v1/app-manager/menu-items': {
    filters: ['menuId', 'isActive', 'search'],
    sorts: ['menuId', 'key', 'label', 'order', 'isActive', 'updatedAt'],
    defaultLimit: 50,
  },
  '/api/v1/app-manager/menu-accesses': {
    filters: ['menuItemId', 'role', 'section'],
    sorts: ['menuItemId', 'role', 'section', 'updatedAt'],
    defaultLimit: 20,
  },
  '/api/v1/app-manager/office-branches': {
    filters: ['search', 'isHead'],
    sorts: ['name', 'address', 'telp', 'email', 'isHead', 'updatedAt'],
    defaultLimit: 20,
  },
  '/api/v1/marketing/companies': {
    filters: ['search', 'hasContract'],
    sorts: ['name', 'type', 'address', 'hasContract', 'version', 'updatedAt'],
    defaultLimit: 20,
  },
  '/api/v1/marketing/company-staffs': {
    filters: ['companyId', 'search', 'title'],
    sorts: ['companyId', 'name', 'title', 'version', 'updatedAt'],
    defaultLimit: 20,
  },
  '/api/v1/marketing/services': {
    filters: ['name', 'isActive'],
    sorts: ['name', 'isActive'],
    defaultLimit: 20,
  },
  '/api/v1/marketing/items': {
    filters: ['serviceName', 'itemName', 'size'],
    sorts: ['serviceName', 'itemName', 'size'],
    defaultLimit: 20,
  },
};

const listContractErrors = [];
for (const [path, contract] of Object.entries(expectedListContracts)) {
  const parameters = openApiDocument.paths[path]?.get?.parameters || [];
  const queryParameters = parameters.filter((parameter) => parameter.in === 'query');
  const actualNames = queryParameters.map((parameter) => parameter.name).sort();
  const expectedNames = ['page', 'limit', ...contract.filters, 'sortBy', 'sortOrder'].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    listContractErrors.push({ path, field: 'queryParameters', expected: expectedNames, actual: actualNames });
  }
  const sortBy = queryParameters.find((parameter) => parameter.name === 'sortBy');
  if (JSON.stringify(sortBy?.schema?.enum) !== JSON.stringify(contract.sorts)) {
    listContractErrors.push({ path, field: 'sortBy', expected: contract.sorts, actual: sortBy?.schema?.enum });
  }
  const limit = queryParameters.find((parameter) => parameter.name === 'limit');
  if (limit?.schema?.default !== contract.defaultLimit || limit?.schema?.maximum !== 100) {
    listContractErrors.push({
      path, field: 'limit', expected: { default: contract.defaultLimit, maximum: 100 }, actual: limit?.schema,
    });
  }
}

const schemaContractErrors = [];
const schemas = openApiDocument.components?.schemas || {};
const mergedUserPath = openApiDocument.paths['/api/v1/auth/users/{userId}'];
for (const legacyPath of [
  '/api/v1/auth/users/{userId}/role',
  '/api/v1/auth/users/{userId}/section',
  '/api/v1/auth/users/{userId}/status',
]) {
  if (openApiDocument.paths[legacyPath]) schemaContractErrors.push({ path: legacyPath, error: 'Legacy user PATCH path still exists' });
}
if (!mergedUserPath?.patch) schemaContractErrors.push({ path: '/api/v1/auth/users/{userId}', error: 'Merged PATCH operation is missing' });
if (mergedUserPath?.put) schemaContractErrors.push({ path: '/api/v1/auth/users/{userId}', error: 'User update must use PATCH, not PUT' });
if (mergedUserPath?.patch?.requestBody?.content?.['application/json']?.schema?.$ref !== '#/components/schemas/UpdateUserRequest') {
  schemaContractErrors.push({ schema: 'UpdateUserRequest', error: 'Merged PATCH does not reference UpdateUserRequest' });
}

const updateUserProperties = Object.keys(schemas.UpdateUserRequest?.properties || {}).sort();
const expectedUpdateUserProperties = ['role', 'section', 'officeBranchId', 'isActive', 'version'].sort();
if (JSON.stringify(updateUserProperties) !== JSON.stringify(expectedUpdateUserProperties)) {
  schemaContractErrors.push({ schema: 'UpdateUserRequest', expected: expectedUpdateUserProperties, actual: updateUserProperties });
}
if (!schemas.UpdateUserRequest?.required?.includes('version') || schemas.UpdateUserRequest?.minProperties !== 2) {
  schemaContractErrors.push({ schema: 'UpdateUserRequest', error: 'version and at least one editable field must be required' });
}
if (!schemas.UserProfile?.required?.includes('officeBranchId') || !schemas.UserProfile?.properties?.officeBranchId?.nullable) {
  schemaContractErrors.push({ schema: 'UserProfile', error: 'Nullable officeBranchId is missing' });
}
if (!schemas.AccessTokenClaims?.required?.includes('officeBranchId') || !schemas.AccessTokenClaims?.properties?.officeBranchId?.nullable) {
  schemaContractErrors.push({ schema: 'AccessTokenClaims', error: 'Nullable officeBranchId claim is missing' });
}
for (const schemaName of ['Company', 'Service', 'ServiceListItem', 'Item']) {
  if (!schemas[schemaName]?.required?.includes('officeBranchId') || schemas[schemaName]?.properties?.officeBranchId?.format !== 'uuid') {
    schemaContractErrors.push({ schema: schemaName, error: 'Required officeBranchId ownership field is missing' });
  }
}
if (!schemas.OfficeBranch?.required?.includes('isHead') || schemas.OfficeBranch?.properties?.isHead?.type !== 'boolean') {
  schemaContractErrors.push({ schema: 'OfficeBranch', error: 'Boolean isHead is missing' });
}
if (!schemas.OfficeBranchListResponse?.properties?.data?.properties?.officeBranches) {
  schemaContractErrors.push({ schema: 'OfficeBranchListResponse', error: 'officeBranches collection is missing' });
}
const optionSchema = schemas.OfficeBranchOption;
if (JSON.stringify(Object.keys(optionSchema?.properties || {}).sort()) !== JSON.stringify(['id', 'name'])) {
  schemaContractErrors.push({ schema: 'OfficeBranchOption', error: 'Option response must contain only id and name' });
}
const optionResponseRef = openApiDocument.paths['/api/v1/app-manager/office-branches/options']
  ?.get?.responses?.[200]?.content?.['application/json']?.schema?.$ref;
if (optionResponseRef !== '#/components/schemas/OfficeBranchOptionsResponse') {
  schemaContractErrors.push({ path: '/api/v1/app-manager/office-branches/options', error: 'Invalid options response schema' });
}

if (missing.length || extra.length || brokenReferences.length || listContractErrors.length || schemaContractErrors.length) {
  console.error(JSON.stringify({ missing, extra, brokenReferences, listContractErrors, schemaContractErrors }, null, 2));
  process.exit(1);
}

console.log(`OpenAPI verified: ${actualOperations.length} operations and ${references.size} references.`);
