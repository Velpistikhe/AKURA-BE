const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: 'string', format: 'uuid' };
const version = { type: 'integer', minimum: 0, description: 'Concurrency token. Submit the latest resource version; stale versions return 409.' };
const timestamp = { type: 'string', format: 'date-time' };
const date = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const money = { oneOf: [{ type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER / 100, multipleOf: 0.01 }, { type: 'string', pattern: '^\\d{1,16}(\\.\\d{1,2})?$' }], description: 'Required nonnegative price. Explicit zero is allowed. No default; null, blank strings and booleans are rejected. Use decimal strings for large amounts.' };
const optionalMoney = { ...money, nullable: true };
const decimal = { type: 'string', format: 'decimal', example: '100.25' };
const standard = { priceServicePrimary: money, priceServiceSisterCompany: money, priceMaintenancePrimary: optionalMoney, priceMaintenanceSisterCompany: optionalMoney };
const periods = { effectiveFrom: timestamp, effectiveUntil: { ...timestamp, nullable: true } };
const contractPeriods = { effectiveFrom: date, effectiveUntil: date };
const contractStatus = { type: 'string', enum: ['CREATE', 'ACTIVE', 'EXPIRED', 'TERMINATED'] };
const audit = { version, createdById: uuid, createdByName: { type: 'string' }, updatedById: { ...uuid, nullable: true }, updatedByName: { type: 'string', nullable: true }, createdAt: timestamp, updatedAt: timestamp };
const object = (properties: object, required: string[] = []) => ({ type: 'object', required, properties });
const input = (properties: object, required: string[]) => ({ ...object(properties, required), additionalProperties: false });
const envelope = (data: object) => object({ status: { type: 'integer' }, success: { type: 'boolean' }, data, requestId: uuid }, ['status', 'success', 'data']);
const paginated = (name: string, row: object) => envelope(object({ [name]: { type: 'array', items: row }, pagination: ref('Pagination') }, [name, 'pagination']));
const price = object({ id: uuid, itemSizeId: uuid, ...audit, ...periods, isActive: { type: 'boolean' },
  priceServicePrimary: decimal, priceServiceSisterCompany: decimal,
  priceMaintenancePrimary: { ...decimal, nullable: true }, priceMaintenanceSisterCompany: { ...decimal, nullable: true },
}, ['id', 'itemSizeId', 'version', 'priceServicePrimary', 'priceServiceSisterCompany', 'isActive']);
const contractPrice = object({ id: uuid, contractId: uuid, itemSizeId: uuid, ...audit, ...periods, isActive: { type: 'boolean' }, priceService: decimal, priceMaintenance: { ...decimal, nullable: true }, contract: ref('CompanyContract') }, ['id', 'contractId', 'itemSizeId', 'version', 'priceService', 'priceMaintenance', 'isActive']);
const contract = object({ id: uuid, companyId: uuid, contractNumber: { type: 'string' }, contractDate: date, status: contractStatus, ...contractPeriods, isActive: { type: 'boolean' }, hasList: { type: 'boolean', description: 'True when the contract has at least one contract price list.' }, version, createdById: uuid, updatedById: { ...uuid, nullable: true }, createdAt: timestamp, updatedAt: timestamp }, ['id', 'companyId', 'contractNumber', 'contractDate', 'status', 'hasList', 'version', 'effectiveFrom', 'effectiveUntil', 'isActive']);
const sizeRow = { allOf: [ref('ItemSizeListRow'), object({ contractPrice: ref('CompanyContractPrice') }, ['contractPrice'])] };
const profileFields = {
  id: uuid, name: { type: 'string' }, normalizeName: { type: 'string' },
  revoked: { type: 'boolean' }, version: { type: 'integer', minimum: 0 },
  createdById: { ...uuid, nullable: true }, updatedById: { ...uuid, nullable: true },
  createdAt: timestamp, updatedAt: timestamp,
};
const companySnapshotFields = {
  ...profileFields, officeBranchId: uuid, npwp: { type: 'string' },
  type: { type: 'string', enum: ['PT', 'CV', 'FIRMA', 'KOPERASI', 'PERORANGAN'] },
  address: { type: 'string' }, isSisterCompany: { type: 'boolean' },
};
const companySummary = object({
  id: uuid,
  name: { type: 'string' },
  type: { type: 'string', enum: ['PT', 'CV', 'FIRMA', 'KOPERASI', 'PERORANGAN'] },
  version: { type: 'integer', minimum: 0 },
}, ['id', 'name', 'type', 'version']);
const staffSnapshotFields = {
  ...profileFields, companyId: uuid, title: { type: 'string', enum: ['mr', 'mrs'] },
  telp: { type: 'string', nullable: true }, email: { type: 'string', format: 'email', nullable: true },
  company: companySummary,
};
const historyEntry = (idField: string, snapshot: string) => object({
  id: uuid, [idField]: uuid,
  version: { type: 'integer', minimum: 0, description: 'Version captured after this change; CREATE starts at 0.' },
  action: { type: 'string', example: 'UPDATE', description: 'New records use CREATE, UPDATE or DEACTIVATE. Imported legacy records retain their original action.' },
  snapshot: ref(snapshot),
  createdById: { ...uuid, description: 'User who performed this change.' },
  createdByName: { type: 'string', description: 'Snapshot of the user name when this change was recorded.' },
  createdAt: timestamp,
}, ['id', idField, 'version', 'action', 'snapshot', 'createdById', 'createdByName', 'createdAt']);
const historyResponse = (idField: string, entry: string, message: string) => object({
  status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] },
  message: { type: 'string', example: message }, requestId: uuid,
  data: object({ [idField]: uuid, history: { type: 'array', items: ref(entry) }, pagination: ref('Pagination') }, [idField, 'history', 'pagination']),
}, ['status', 'success', 'message', 'data']);
export const catalogSchemas = {
  CompanyHistorySnapshot: {
    ...object(companySnapshotFields, Object.keys(companySnapshotFields)),
    description: 'Company profile after this change. New snapshots contain profile fields only; imported legacy snapshots may include additional fields.',
    example: { id: '11111111-1111-4111-8111-111111111111', officeBranchId: '22222222-2222-4222-8222-222222222222', name: 'Akura Customer', normalizeName: 'akuracustomer', npwp: '0012345678901234', type: 'PT', address: 'Jakarta', isSisterCompany: false, revoked: false, version: 1, createdById: '33333333-3333-4333-8333-333333333333', updatedById: '33333333-3333-4333-8333-333333333333', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z' },
  },
  CompanyStaffHistorySnapshot: {
    ...object(staffSnapshotFields, Object.keys(staffSnapshotFields)),
    description: 'Staff profile after this change, including companyId and the company summary captured when this history entry was written (id, name, type, and version). This is not refreshed from the current live company when history is read. Imported legacy snapshots may omit company or include additional fields.',
    example: { id: '44444444-4444-4444-8444-444444444444', companyId: '11111111-1111-4111-8111-111111111111', name: 'Budi', normalizeName: 'budi', title: 'mr', telp: null, email: 'budi@example.com', revoked: false, version: 1, createdById: '33333333-3333-4333-8333-333333333333', updatedById: '33333333-3333-4333-8333-333333333333', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z', company: { id: '11111111-1111-4111-8111-111111111111', name: 'Akura Customer', type: 'PT', version: 1 } },
  },
  CompanyHistory: historyEntry('companyId', 'CompanyHistorySnapshot'),
  CompanyStaffHistory: historyEntry('companyStaffId', 'CompanyStaffHistorySnapshot'),
  CompanyHistoryResponse: historyResponse('companyId', 'CompanyHistory', 'Company history retrieved successfully'),
  CompanyStaffHistoryResponse: historyResponse('companyStaffId', 'CompanyStaffHistory', 'Company staff history retrieved successfully'),
  CompanyStaffAggregateHistoryResponse: historyResponse('companyId', 'CompanyStaffHistory', 'Company staff history retrieved successfully'),
  CatalogMoney: money,
  CatalogNullableMoney: optionalMoney,
  CatalogVersionRequest: input({ version }, ['version']),
  UpdateItemRequest: input({ version, name: { type: 'string', minLength: 1, maxLength: 200 } }, ['version', 'name']),
  UpdateItemSizeRequest: input({ version, size: { type: 'string', minLength: 1, maxLength: 100 } }, ['version', 'size']),
  CatalogPriceRequest: { ...input(standard, ['priceServicePrimary', 'priceServiceSisterCompany']), description: 'Both service prices are required. Both maintenance prices are required when the service hasMaintenance=true.' },
  UpdateCatalogPriceRequest: input({ version, ...standard, isActive: { type: 'boolean', description: 'Use true with the current version to reactivate a price; audit preserves the previous state.' } }, ['version', 'priceServicePrimary', 'priceServiceSisterCompany']),
  CreateContractPriceRequest: input({ contractId: uuid, priceService: money, priceMaintenance: optionalMoney }, ['contractId', 'priceService']),
  UpsertContractPriceRequest: input({ contractId: uuid, version, priceService: money, priceMaintenance: optionalMoney }, ['contractId', 'priceService']),
  UpdateContractPriceRequest: input({ version, priceService: money, priceMaintenance: optionalMoney, isActive: { type: 'boolean' } }, ['version', 'priceService']),
  CreateCompanyContractRequest: { ...input({ companyId: uuid, contractNumber: { type: 'string', minLength: 1, maxLength: 255 }, contractDate: date, ...contractPeriods }, ['companyId', 'contractNumber', 'contractDate', 'effectiveFrom', 'effectiveUntil']), description: 'Status is not accepted. User creation sets CREATE; ADMIN/APP_MANAGER creation sets ACTIVE. The company must not already have an ACTIVE contract. All contract dates use YYYY-MM-DD and effectiveUntil must follow effectiveFrom.' },
  UpdateCompanyContractRequest: { ...input({ version, contractNumber: { type: 'string', minLength: 1, maxLength: 255 }, contractDate: date, ...contractPeriods }, ['version', 'effectiveFrom', 'effectiveUntil']), description: 'Admin-only revision. It terminates the previous contract with effectiveUntil = new effectiveFrom minus one day, then creates an ACTIVE replacement. Status is not accepted.' },
  TerminateCompanyContractRequest: input({ version, terminatedAt: date }, ['version', 'terminatedAt']),
  CatalogItemPrice: price, CatalogItemPriceResponse: envelope(ref('CatalogItemPrice')),
  CompanyContract: contract, CompanyContractResponse: envelope(ref('CompanyContract')),
  CompanyContractPrice: contractPrice, CompanyContractPriceResponse: envelope(ref('CompanyContractPrice')),
  CompanyContractPriceListResponse: paginated('prices', ref('CompanyContractPrice')),
  CompanyContractListResponse: paginated('contracts', ref('CompanyContract')),
  CompanyContractPriceHistoryResponse: envelope(object({
    contractPriceId: uuid,
    history: { type: 'array', items: object({ id: uuid, action: { type: 'string' }, version, changedBy: object({ id: uuid, name: { type: 'string' } }, ['id', 'name']), changedAt: timestamp, changes: { type: 'array', items: object({ field: { type: 'string' }, label: { type: 'string' }, before: { nullable: true }, after: { nullable: true } }, ['field', 'label', 'before', 'after']) } }, ['id', 'action', 'version', 'changedBy', 'changedAt', 'changes']) },
    pagination: ref('Pagination'),
  }, ['contractPriceId', 'history', 'pagination'])),
  CatalogContractSizeListResponse: paginated('sizes', sizeRow),
  CatalogSizeDetailResponse: envelope(object({ id: uuid, itemId: uuid, size: { type: 'string' }, ...audit, ...periods, isActive: { type: 'boolean' }, price: { ...price, nullable: true }, item: ref('ItemListRow') }, ['id', 'itemId', 'version', 'size', 'price', 'item'])),
  CatalogSizeMutationResponse: envelope(object({ id: uuid, itemId: uuid, size: { type: 'string' }, isActive: { type: 'boolean' }, ...periods, ...audit }, ['id', 'itemId', 'size', 'version'])),
  CatalogItemMutationResponse: envelope(object({ id: uuid, officeBranchId: uuid, serviceId: uuid, name: { type: 'string' }, isActive: { type: 'boolean' }, ...audit }, ['id', 'name', 'version'])),
  ResolvedPriceListResponse: envelope(object({
    company: object({ id: uuid, isSisterCompany: { type: 'boolean' } }, ['id', 'isSisterCompany']),
    sizes: { type: 'array', items: { allOf: [ref('ItemSizeListRow'), object({
      contractId: { ...uuid, nullable: true }, contractPrice: { ...contractPrice, nullable: true },
      priceSource: { type: 'string', enum: ['CONTRACT', 'SISTER_COMPANY', 'PRIMARY'] },
      priceStatus: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] }, priceMessage: { type: 'string', nullable: true },
      priceService: { ...decimal, nullable: true }, priceMaintenance: { ...decimal, nullable: true },
    }, ['priceSource', 'priceStatus', 'priceMessage', 'priceService', 'priceMaintenance', 'contractId', 'contractPrice'])] } },
    pagination: ref('Pagination'),
  }, ['company', 'sizes', 'pagination'])),
  CatalogHistoryResponse: paginated('history', object({ id: uuid, officeBranchId: uuid, entityType: { type: 'string' }, entityId: uuid, version, action: { type: 'string' }, before: { type: 'object', nullable: true }, after: { type: 'object' }, createdById: uuid, createdByName: { type: 'string' }, createdAt: timestamp })),
};
const parameter = (name: string, schema: object, required = false, location = 'query') => ({ in: location, name, required, schema });
const path = (name: string) => parameter(name, uuid, true, 'path');
const pagination = [parameter('page', { type: 'integer', minimum: 1, default: 1 }), parameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 })];
const filters = [parameter('itemId', uuid), ...['size', 'itemName', 'serviceName'].map(name => ({ ...parameter(name, { type: 'string', minLength: 1, maxLength: name === 'size' ? 100 : 200 }), description: 'Case-insensitive partial match; combines with other filters using AND.' })),
  { ...parameter('notIn', { type: 'array', minItems: 1, maxItems: 100, items: uuid }), style: 'form', explode: false, description: 'Comma-separated item size UUIDs to exclude; omit when empty.' },
  parameter('sortBy', { type: 'string', enum: ['size'], description: 'Omit for createdAt descending.' }), parameter('sortOrder', { type: 'string', enum: ['asc', 'desc'], default: 'desc' }), ...pagination];
const content = (schema: object) => ({ content: { 'application/json': { schema } } });
const operation = (summary: string, response: string, parameters: object[] = [], body?: string, status = 200, description = '') => ({
  tags: ['Marketing'], summary, description, security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters,
  ...(body ? { requestBody: { required: true, ...content(ref(body)) } } : {}),
  responses: { [status]: { description: 'Success', ...content(ref(response)) }, ...Object.fromEntries([
    [400, 'Invalid parameters, missing required prices, or invalid contract period'], [401, 'Authentication required'], [403, 'Marketing access and branch assignment required'], [404, 'Resource not found in the current branch'], [409, 'Stale version, inactive resource, duplicate size/price, or overlapping contract'], [429, 'Rate limit exceeded'], [500, 'Internal server error'],
  ].map(([code, description]) => [code, { description, ...content(ref('ErrorResponse')) }])) },
});
const historyOperation = (summary: string, response: string, idField: string, description: string, sortDescription = 'Sorted by version descending.') => ({
  tags: ['Marketing'], summary, security: [{ bearerAuth: [] }, { accessTokenCookie: [] }],
  description: description + ` ${sortDescription} Supports only page (default 1) and limit (default 20, maximum 100); unknown query parameters are rejected. An empty page returns history: [] with pagination. History is read-only.`,
  parameters: [path(idField), ...pagination],
  responses: {
    200: { description: 'History with pagination', ...content(ref(response)) },
    ...Object.fromEntries([
      [400, 'Invalid UUID, page, limit, or unknown query parameter'], [401, 'Authentication required'],
      [403, 'Marketing access and branch assignment required'], [404, 'Entity not found in the current branch'],
      [429, 'Rate limit exceeded'], [500, 'Internal server error'],
    ].map(([code, description]) => [code, { description, ...content(ref('ErrorResponse')) }])),
  },
});
const root = '/api/v1/marketing';
export const catalogPaths = {
  [`${root}/company-staffs/{companyStaffId}/history`]: { get: historyOperation('Read company staff history', 'CompanyStaffHistoryResponse', 'companyStaffId', 'Includes CREATE, UPDATE and DEACTIVATE, including deactivation through the company. Available after staff or company soft deletion. Access follows the current parent company branch.') },
  [`${root}/companies/{companyId}/staff-history`]: { get: historyOperation('Read all staff history for a company', 'CompanyStaffAggregateHistoryResponse', 'companyId', 'Returns history entries for every staff assigned to the company, including deactivation through the company. Available for soft-deleted companies in the token branch.', 'Sorted by history creation time descending, then ID descending.') },
  [`${root}/companies/{companyId}/history`]: { get: historyOperation('Read company profile history', 'CompanyHistoryResponse', 'companyId', 'Includes CREATE, UPDATE and DEACTIVATE. Available for soft-deleted companies in the token branch. Company snapshots are separate from staff history.') },
  [`${root}/items/sizes/export`]: {
    get: {
      tags: ['Marketing'], summary: 'Download Excel template with service, item, size and normal primary prices',
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }],
      parameters: [parameter('companyId', uuid), ...filters.filter(field => !['page', 'limit'].includes(field.name))],
      description: 'Returns up to 2000 active sizes in the token branch. Optional companyId must belong to the same branch and must not be revoked; otherwise 404. Item and service are both restricted to the token branch. Edit Harga Service/Harga Maintenance and select YA for rows to import into a company contract. Hidden IDs and versions must remain unchanged. Missing normal prices are blank; sister-company and contract prices are not exported.',
      responses: {
        200: { description: 'Excel contract-price template', content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: { type: 'string', format: 'binary' } } } },
        400: { description: 'Invalid filters or export exceeds 2000 rows' },
        404: { description: 'Item not found in the current branch' },
      },
    },
  },
  [`${root}/company-contracts/{contractId}/prices/import`]: {
    post: {
      tags: ['Marketing'], summary: 'Upload Excel template to create company contract prices atomically',
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters: [path('contractId')],
      requestBody: { required: true, content: { 'multipart/form-data': { schema: input({
        file: { type: 'string', format: 'binary', description: '.xlsx template, maximum 5 MB' }, companyId: uuid, version,
      }, ['file', 'companyId', 'version']) } } },
      responses: {
        201: { description: 'All selected rows imported', ...content(envelope(object({ companyId: uuid, contractId: uuid, version, imported: { type: 'integer' } }))) },
        400: { description: 'Invalid workbook or row values; no prices saved' },
        403: { description: 'Template belongs to a different branch' },
        404: { description: 'Company contract not found in the current branch' },
        409: { description: 'Stale versions, duplicate prices, or contract cannot accept prices' },
        413: { description: 'File exceeds 5 MB' },
      },
    },
  },
  [`${root}/items`]: {
    get: operation('List active items', 'ItemListResponse', [...['name', 'serviceName'].map(name => parameter(name, { type: 'string', minLength: 1, maxLength: 200 })), parameter('sortBy', { type: 'string', enum: ['name', 'serviceName'] }), parameter('sortOrder', { type: 'string', enum: ['asc', 'desc'], default: 'desc' }), ...pagination]),
    post: operation('Create item, sizes and standard prices atomically', 'ItemResponse', [], 'CreateItemRequest', 201, 'Every created row receives version 0 and an audit entry. Required service prices have no defaults.'),
  },
  [`${root}/items/{itemId}`]: {
    get: operation('Get active item', 'ItemDetailResponse', [path('itemId')]),
    patch: operation('Update item name using its current version', 'CatalogItemMutationResponse', [path('itemId')], 'UpdateItemRequest'),
    delete: operation('Deactivate item, active sizes and their prices atomically', 'ItemResponse', [path('itemId')], 'CatalogVersionRequest', 200, 'Soft deletion; all changed rows increment version and append before/after audit snapshots. Historical inactive records remain unchanged.'),
  },
  [`${root}/items/sizes`]: {
    get: operation('List active sizes across items in the current branch', 'ItemSizeListResponse', filters, undefined, 200, 'itemId is optional. Includes item and item.service. Missing or inactive standard prices are null with priceStatus=UNAVAILABLE.'),
    post: operation('Add size and standard prices atomically', 'ItemSizeResponse', [], 'AddItemSizeRequest', 201, 'itemVersion is the latest parent item version. Returns the new itemVersion. Requires both service prices; no default zero. A previously inactive size name may be reused with a new ID.'),
  },
  [`${root}/items/sizes/{itemSizeId}`]: {
    get: operation('Get size including raw price and current versions', 'CatalogSizeDetailResponse', [path('itemSizeId')]),
    patch: operation('Update size label using its version', 'CatalogSizeMutationResponse', [path('itemSizeId')], 'UpdateItemSizeRequest'),
    delete: operation('Deactivate size and its active prices', 'ItemSizeResponse', [path('itemSizeId')], 'CatalogVersionRequest'),
  },
  [`${root}/items/sizes/{itemSizeId}/price`]: {
    get: operation('Get standard price including inactive state and version', 'CatalogItemPriceResponse', [path('itemSizeId')]),
    post: operation('Create missing standard price', 'CatalogItemPriceResponse', [path('itemSizeId')], 'CatalogPriceRequest', 201),
    patch: operation('Update or reactivate standard price using its version', 'CatalogItemPriceResponse', [path('itemSizeId')], 'UpdateCatalogPriceRequest'),
    delete: operation('Deactivate standard price using its version', 'CatalogItemPriceResponse', [path('itemSizeId')], 'CatalogVersionRequest'),
  },
  [`${root}/items/sizes/{itemSizeId}/contract-prices`]: {
    post: operation('Create size price for a company contract', 'CompanyContractPriceResponse', [path('itemSizeId')], 'CreateContractPriceRequest', 201, 'contractId replaces companyId. One row per contract/size. Maintenance price is required for services with maintenance. Parent contract version increments.'),
    put: operation('Create or update a company contract price', 'CompanyContractPriceResponse', [path('itemSizeId')], 'UpsertContractPriceRequest', 200, 'Creates a price when none exists for contractId/itemSizeId. When it already exists, updates its prices and requires the current version.'),
  },
  [`${root}/items/contract-prices/{contractPriceId}`]: {
    patch: operation('Update or reactivate contract price using its version', 'CompanyContractPriceResponse', [path('contractPriceId')], 'UpdateContractPriceRequest'),
    delete: operation('Deactivate contract price using its version', 'CompanyContractPriceResponse', [path('contractPriceId')], 'CatalogVersionRequest'),
  },
  [`${root}/company-contract-prices`]: {
    get: operation('List company contract prices in the current branch', 'CompanyContractPriceListResponse', [
      parameter('contractId', uuid), parameter('companyId', uuid), parameter('itemSizeId', uuid), parameter('isActive', { type: 'string', enum: ['true', 'false'] }), parameter('search', { type: 'string' }),
      parameter('sortBy', { type: 'string', enum: ['priceService', 'priceMaintenance', 'effectiveFrom', 'effectiveUntil', 'createdAt', 'updatedAt'] }), parameter('sortOrder', { type: 'string', enum: ['asc', 'desc'], default: 'desc' }), ...pagination,
    ], undefined, 200, 'Returns all contract price lists belonging to the authenticated user branch, including inactive, future, terminated, and expired contracts unless filtered.'),
  },
  [`${root}/items/sizes/prices`]: { get: operation('Resolve prices for a company', 'ResolvedPriceListResponse', [parameter('companyId', uuid, true), ...filters], undefined, 200, 'Priority: current active contract, otherwise sister company standard price when isSisterCompany=true, otherwise primary standard price. If a current contract lacks a size price, return UNAVAILABLE and null prices without fallback. Missing/inactive standard prices are also UNAVAILABLE. Explicit zero remains AVAILABLE. Includes item/service, selected priceSource, contract and pagination.') },
  [`${root}/company-contracts`]: {
    get: operation('List company contracts in the current branch', 'CompanyContractListResponse', [parameter('companyId', uuid), parameter('isActive', { type: 'string', enum: ['true', 'false'] }), parameter('status', contractStatus), ...pagination]),
    post: operation('Create company contract', 'CompanyContractResponse', [], 'CreateCompanyContractRequest', 201),
  },
  [`${root}/company-contracts/{contractId}`]: {
    get: operation('Get company contract', 'CompanyContractResponse', [path('contractId')]),
    patch: operation('Revise company contract (admin)', 'CompanyContractResponse', [path('contractId')], 'UpdateCompanyContractRequest'),
    delete: operation('Terminate company contract (admin)', 'CompanyContractResponse', [path('contractId')], 'TerminateCompanyContractRequest', 200, 'Sets TERMINATED, isActive=false, and effectiveUntil to terminatedAt; the change is saved in contract history.'),
  },
  [`${root}/company-contract-prices/{contractPriceId}/history`]: {
    get: operation('Read user-friendly company contract price history', 'CompanyContractPriceHistoryResponse', [path('contractPriceId'), ...pagination], undefined, 200, 'Returns field-level changes with Indonesian labels, values before/after, actor, and timestamp. Only the current branch may read the history.'),
  },
  [`${root}/company-contracts/{contractId}/approve`]: {
    post: operation('Approve company contract (admin)', 'CompanyContractResponse', [path('contractId')], 'CatalogVersionRequest', 200, 'Changes a CREATE contract to ACTIVE. Only ADMIN or APP_MANAGER may approve.'),
  },
};
