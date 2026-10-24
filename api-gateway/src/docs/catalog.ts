const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: 'string', format: 'uuid' };
const version = { type: 'integer', minimum: 0, description: 'Concurrency token. Submit the latest resource version; stale versions return 409.' };
const timestamp = { type: 'string', format: 'date-time' };
const date = { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const money = { oneOf: [{ type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER / 100, multipleOf: 0.01 }, { type: 'string', pattern: '^\\d{1,16}(\\.\\d{1,2})?$' }], description: 'Required nonnegative price. Explicit zero is allowed. No default; null, blank strings and booleans are rejected. Use decimal strings for large amounts.' };
const optionalMoney = { ...money, nullable: true };
const decimal = { type: 'string', format: 'decimal', example: '100.25' };
const standard = { priceServicePrimary: money, priceServiceSisterCompany: { ...optionalMoney, description: 'Optional sister-company price.' }, priceMaintenancePrimary: optionalMoney, priceMaintenanceSisterCompany: optionalMoney };
const periods = { effectiveFrom: timestamp, effectiveUntil: { ...timestamp, nullable: true } };
const contractPeriods = { effectiveFrom: date, effectiveUntil: date };
const contractStatus = { type: 'string', enum: ['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED', 'TERMINATED', 'REVISED'] };
const audit = { version, createdById: uuid, createdByName: { type: 'string' }, updatedById: { ...uuid, nullable: true }, updatedByName: { type: 'string', nullable: true }, createdAt: timestamp, updatedAt: timestamp };
const object = (properties: object, required: string[] = []) => ({ type: 'object', required, properties });
const input = (properties: object, required: string[]) => ({ ...object(properties, required), additionalProperties: false });
const envelope = (data: object) => object({ status: { type: 'integer' }, success: { type: 'boolean' }, data, requestId: uuid }, ['status', 'success', 'data']);
const paginated = (name: string, row: object) => envelope(object({ [name]: { type: 'array', items: row }, pagination: ref('Pagination') }, [name, 'pagination']));
const price = object({ id: uuid, itemSizeId: uuid, ...audit, ...periods, isActive: { type: 'boolean' },
  priceServicePrimary: decimal, priceServiceSisterCompany: decimal,
  priceMaintenancePrimary: { ...decimal, nullable: true }, priceMaintenanceSisterCompany: { ...decimal, nullable: true },
}, ['id', 'itemSizeId', 'version', 'priceServicePrimary', 'priceServiceSisterCompany', 'isActive']);
const contractPrice = object({ catalogSnapshot: ref('ContractCatalogSnapshot'), id: uuid, contractId: uuid, itemSizeId: uuid, ...audit, ...periods, isActive: { type: 'boolean' }, priceService: decimal, priceMaintenance: { ...decimal, nullable: true }, contract: ref('CompanyContract') }, ['id', 'contractId', 'itemSizeId', 'version', 'priceService', 'priceMaintenance', 'isActive', 'catalogSnapshot']);
const contract = object({ id: uuid, companyId: uuid, companySnapshot: { type: 'object', nullable: true, additionalProperties: true, readOnly: true }, revisionOfId: { ...uuid, nullable: true, readOnly: true }, contractNumber: { type: 'string' }, contractDate: date, status: contractStatus, ...contractPeriods, hasList: { type: 'boolean', description: 'True when the contract has at least one contract price list.' }, version, createdById: uuid, updatedById: { ...uuid, nullable: true }, createdAt: timestamp, updatedAt: timestamp }, ['id', 'companyId', 'contractNumber', 'contractDate', 'status', 'hasList', 'version', 'effectiveFrom', 'effectiveUntil']);
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
  ContractCatalogSnapshot: { ...object({ serviceName: { type: 'string' }, serviceType: ref('ServiceType'), itemName: { type: 'string' }, size: { type: 'string', nullable: true, description: 'Null for an item variant without a size.' }, hasMaintenance: { type: 'boolean' } }, ['serviceName', 'serviceType', 'itemName', 'size', 'hasMaintenance']), readOnly: true, description: 'Frozen catalog identity at contract-price creation/import. Catalog edits and soft deletion never refresh this snapshot.' },
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
  UpdateItemRequest: { ...input({ version, name: { type: 'string', minLength: 1, maxLength: 200 }, uom: { type: 'string', minLength: 1, maxLength: 50, example: 'JOINT' } }, ['version']), minProperties: 2, description: 'Provide version and at least one of name or uom. Omitted fields are preserved. Unit of measure is normalized and trimmed; null and blank values are rejected.' },
  CatalogPriceRequest: { ...input({ ...standard }, ['priceServicePrimary']), description: 'Primary service price is required; sister-company price is optional. A size must retain at least one active primary price.' },
  UpdateContractPriceRequest: input({ version, priceService: money, priceMaintenance: optionalMoney, isActive: { type: 'boolean' } }, ['version', 'priceService']),
  UpdateCatalogPriceRequest: { ...input({ version, ...standard, isActive: { type: 'boolean', description: 'An active price may be deactivated. Inactive prices cannot be modified or reactivated.' } }, ['version']), minProperties: 2, description: 'Partial PATCH: provide version and at least one editable field. Omitted amounts are preserved. The merged price must satisfy maintenance requirements. Inactive service, item, size, price, or stale versions return 409.' },
  CreateContractPriceRequest: input({ contractId: uuid, priceService: money, priceMaintenance: optionalMoney }, ['contractId', 'priceService']),
  CreateCompanyContractRequest: { ...input({ companyId: uuid, contractNumber: { type: 'string', minLength: 1, maxLength: 255 }, contractDate: { ...date, description: 'Contract date must be on or before effectiveFrom.' }, ...contractPeriods }, ['companyId', 'contractNumber', 'contractDate', 'effectiveFrom', 'effectiveUntil']), description: 'New contracts are always created with DRAFT status. Creation is rejected when the company has a DRAFT or currently/future APPROVED contract.' },
  UpdateCompanyContractRequest: { ...input({ version, contractNumber: { type: 'string', minLength: 1, maxLength: 255 }, contractDate: { ...date, description: 'Contract date must be on or before effectiveFrom.' }, ...contractPeriods }, ['version', 'contractNumber', 'contractDate', 'effectiveFrom', 'effectiveUntil']), description: 'DRAFT updates are allowed for MARKETING roles; APPROVED updates require ADMIN/MARKETING. Effective intervals are checked for overlap.' },
  ReviseCompanyContractRequest: { ...input({ version, contractNumber: { type: 'string', minLength: 1, maxLength: 255 }, contractDate: { ...date, description: 'Contract date must be on or before effectiveFrom.' }, ...contractPeriods }, ['version', 'contractNumber', 'contractDate', 'effectiveFrom', 'effectiveUntil']), description: 'Creates a DRAFT revision for a current or future APPROVED contract.' },
  TerminateCompanyContractRequest: input({ version, terminatedAt: date }, ['version', 'terminatedAt']),
  CatalogItemPrice: price, CatalogItemPriceResponse: envelope(ref('CatalogItemPrice')),
  CompanyContract: contract, CompanyContractResponse: envelope(ref('CompanyContract')),
  CompanyContractPrice: contractPrice, CompanyContractPriceResponse: envelope(ref('CompanyContractPrice')),
  CompanyContractPriceListResponse: paginated('prices', ref('CompanyContractPrice')),
  CompanyContractListResponse: paginated('contracts', ref('CompanyContract')),
  CompanyContractHistoryResponse: envelope(object({
    contractId: uuid,
    history: { type: 'array', items: object({
      id: uuid, companyContractId: uuid, version, action: { type: 'string' }, snapshot: { type: 'object', additionalProperties: true },
      createdById: uuid, createdByName: { type: 'string' }, createdAt: timestamp,
    }, ['id', 'companyContractId', 'version', 'action', 'snapshot', 'createdById', 'createdByName', 'createdAt']) },
    pagination: ref('Pagination'),
  }, ['contractId', 'history', 'pagination'])),

  ContractPriceOption: object({ id: uuid, itemId: uuid, size: { type: 'string', nullable: true }, version, itemName: { type: 'string' }, serviceName: { type: 'string', nullable: true } }, ['id', 'itemId', 'size', 'version', 'itemName', 'serviceName']),
  ContractPriceOptionListResponse: paginated('sizes', ref('ContractPriceOption')),
  CatalogContractSizeListResponse: paginated('sizes', sizeRow),
  CatalogSizeDetailResponse: envelope(object({ id: uuid, itemId: uuid, size: { type: 'string', nullable: true, description: 'Null for an item variant without a size.' }, ...audit, ...periods, isActive: { type: 'boolean' }, price: { ...price, nullable: true }, item: ref('ItemListRow') }, ['id', 'itemId', 'version', 'size', 'price', 'item'])),
  CatalogItemMutationResponse: envelope(object({ id: uuid, officeBranchId: uuid, serviceId: uuid, name: { type: 'string' }, uom: { type: 'string', example: 'JOINT' }, isActive: { type: 'boolean' }, ...audit }, ['id', 'name', 'uom', 'version'])),
  QuotationSizeOption: object({
    id: uuid, itemId: uuid, size: {type:'string',nullable:true}, version, isActive:{type:'boolean'}, createdAt:timestamp, updatedAt:timestamp,
    item: object({id:uuid,name:{type:'string'},version,service:object({id:uuid,name:{type:'string'},type:ref('ServiceType'),hasMaintenance:{type:'boolean'},version})}),
    catalogSnapshot:ref('ContractCatalogSnapshot'),catalogActive:{type:'boolean'},
    priceSource:{type:'string',enum:['PRIMARY','SISTER_COMPANY','CONTRACT']},
    priceStatus:{type:'string',enum:['AVAILABLE','UNAVAILABLE']},priceMessage:{type:'string',nullable:true},
    priceService:{...decimal,nullable:true},priceInspection:{...decimal,nullable:true},priceMaintenance:{...decimal,nullable:true},
    priceId:{...uuid,nullable:true},priceVersion:{...version,nullable:true},
    contractId:{...uuid,nullable:true},contractVersion:{...version,nullable:true},
    sizeVersion:version,itemVersion:version,serviceVersion:version,
    contractPrice: {...contractPrice,nullable:true},
  }, ['id','itemId','size','item','catalogSnapshot','catalogActive','priceSource','priceStatus','priceService','priceMaintenance','priceId','priceVersion','contractId','contractVersion','sizeVersion','itemVersion','serviceVersion']),
  ResolvedPriceListResponse: envelope(object({company:object({id:uuid,name:{type:'string'},isSisterCompany:{type:'boolean'}}),sizes:{type:'array',items:ref('QuotationSizeOption')},pagination:ref('Pagination')},['company','sizes','pagination'])),
  ItemCatalogHistoryResponse: envelope(object({
    entityType: { type: 'string', enum: ['ITEM', 'ITEM_SIZE', 'ITEM_PRICE'] }, entityId: uuid,
    history: { type: 'array', items: object({
      id: uuid, entityType: { type: 'string' }, entityId: uuid, version, action: { type: 'string' }, actionLabel: { type: 'string' },
      changedBy: object({ id: uuid, name: { type: 'string' } }, ['id', 'name']), changedAt: timestamp,
      changes: { type: 'array', items: object({ field: { type: 'string' }, label: { type: 'string' }, before: {}, after: {} }, ['field', 'label', 'before', 'after']) },
    }, ['id', 'entityType', 'entityId', 'version', 'action', 'actionLabel', 'changedBy', 'changedAt', 'changes']) },
    pagination: ref('Pagination'),
  }, ['entityType', 'entityId', 'history', 'pagination'])),
};
const parameter = (name: string, schema: object, required = false, location = 'query') => ({ in: location, name, required, schema });
const path = (name: string) => parameter(name, uuid, true, 'path');
const pagination = [parameter('page', { type: 'integer', minimum: 1, default: 1 }), parameter('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 })];
const filters = [parameter('itemId', uuid), ...['size', 'itemName', 'serviceName'].map(name => ({ ...parameter(name, { type: 'string', minLength: 1, maxLength: name === 'size' ? 100 : 200 }), description: 'Case-insensitive partial match; combines with other filters using AND.' })),
  { ...parameter('notIn', { type: 'array', minItems: 1, maxItems: 100, items: uuid }), style: 'form', explode: false, description: 'Comma-separated item size UUIDs to exclude; omit when empty.' },
  parameter('sortBy', { type: 'string', enum: ['size'], description: 'Omit for createdAt descending.' }), parameter('sortOrder', { type: 'string', enum: ['asc', 'desc'], default: 'desc' }), ...pagination];
const content = (schema: object) => ({ content: { 'application/json': { schema } } });
const operation = (summary: string, response: string, parameters: object[] = [], body?: string, status = 200, description = '') => ({
  tags: ['Marketing'], summary, description: body && ['UpdateItemRequest', 'CreateItemRequest', 'AddItemSizeRequest', 'CatalogPriceRequest', 'UpdateCatalogPriceRequest', 'CreateContractPriceRequest', 'UpdateContractPriceRequest', 'CatalogVersionRequest'].includes(body)
    ? `${description} Catalog mutations require an active existing item, size, and price where applicable. A service is optional for items; standalone items may own scopes but an item linked to a service cannot own scopes. Inactive catalog records cannot be modified or reactivated; attempts return 409.`.trim()
    : description, security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters,
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
  [`${root}/items/{itemId}/history`]: { get: historyOperation('Read item history', 'ItemCatalogHistoryResponse', 'itemId', 'Includes direct ITEM audit entries and size lifecycle entries (ITEM_SIZE CREATE and DEACTIVATE) for the item. Size price changes and CHILD_UPDATE entries caused by size or price changes are excluded. English field labels, before/after values, actor and action labels. Available after soft deletion.', 'Sorted by creation time descending, then ID descending.') },
  [`${root}/items/sizes/{itemSizeId}/history`]: { get: historyOperation('Read size and price history', 'ItemCatalogHistoryResponse', 'itemSizeId', 'Includes size, standard price and company contract price changes. Available after soft deletion.', 'Sorted by creation time descending, then ID descending.') },
  [`${root}/items/sizes/{itemSizeId}/price/history`]: { get: historyOperation('Read standard price history', 'ItemCatalogHistoryResponse', 'itemSizeId', 'Includes only the standard price audit trail. Returns HTTP 200 with an empty history array and zero pagination totals when the size has no standard price history. Decimal values are strings. Available after soft deletion.', 'Sorted by creation time descending, then ID descending.') },
  [`${root}/company-staffs/{companyStaffId}/history`]: { get: historyOperation('Read company staff history', 'CompanyStaffHistoryResponse', 'companyStaffId', 'Includes CREATE, UPDATE and DEACTIVATE. Available after staff deactivation. Access follows the current parent company branch.') },
  [`${root}/companies/{companyId}/staff-history`]: { get: historyOperation('Read all staff history for a company', 'CompanyStaffAggregateHistoryResponse', 'companyId', 'Returns history entries for every staff assigned to the company. Access follows the current branch.') },
  [`${root}/companies/{companyId}/history`]: { get: historyOperation('Read company profile history', 'CompanyHistoryResponse', 'companyId', 'Includes CREATE and UPDATE history. Company data is retained; no company delete endpoint is available.') },
  [`${root}/items/sizes/export`]: {
    get: {
      tags: ['Marketing'], summary: 'Download Excel template with service, item, size and normal primary prices',
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }],
      parameters: [parameter('companyId', uuid), ...filters.filter(field => !['page', 'limit'].includes(field.name))],
      description: 'Returns up to 2000 active sizes in the token branch, including items with or without a service. Optional companyId must belong to the same branch and must not be revoked; otherwise 404. Default order is service name, item name, size, then ID ascending (PostgreSQL NULLS LAST); items without a service appear last, ordered by item name, size, then ID. Explicit sortBy=size overrides the default order. The English workbook is protected: only Service Price and Maintenance Price are editable. All item rows present are imported; there is no selection column. Use download filters to limit items. Items without a service have a blank Service cell and can have contract prices. Only Item Size ID and Size Version are hidden. Missing normal prices and absent sizes are blank; sister-company and contract prices are not exported.',
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
      description: 'Imports the uploaded rows atomically into the requested Contract. The Contract must belong to the authenticated branch. DRAFT contracts are supported and remain DRAFT after import; the status is never changed by this endpoint. For backward compatibility, non-DRAFT requests resolve to the current or earliest future APPROVED contract for the company. Every row is revalidated against the database, inactive or changed items are rejected, duplicate items are rejected, only editable prices are accepted, and source catalog data is never modified.',
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
    post: operation('Create item references with optional sizes atomically', 'ItemResponse', [], 'CreateItemRequest', 201, 'Unit of measure (uom) is required. Omitted or empty sizes creates one direct-price variant with size=null; additional sizes are prohibited and mixed null/named sizes return 409. Each sizes entry may provide standard primary/sister service prices and, when applicable, both maintenance prices, following CatalogPriceRequest validation. Size and price records are created atomically with audit entries. Entries without prices remain valid and can be priced later using the returned itemSizeId. Duplicate active names return 409.'),
  },
  [`${root}/items/{itemId}`]: {
    get: operation('Get active item', 'ItemDetailResponse', [path('itemId')]),
    patch: operation('Update item name or unit of measure using its current version', 'CatalogItemMutationResponse', [path('itemId')], 'UpdateItemRequest'),
    delete: operation('Deactivate item, active sizes and standard prices atomically', 'ItemResponse', [path('itemId')], 'CatalogVersionRequest', 200, 'Soft deletion; all changed rows increment version and append before/after audit snapshots. Contract prices and contract versions remain unchanged; no contract is created automatically. Historical inactive records remain unchanged.'),
  },
  [`${root}/items/sizes/prices`]: {
    get: operation(
      'List quotation item-size options with resolved prices',
      'ResolvedPriceListResponse',
      [
        parameter('companyId', uuid, true),
        { ...parameter('exclude', { type: 'array', minItems: 1, maxItems: 100, items: uuid }), style: 'form', explode: false, description: 'Comma-separated item-size UUIDs to exclude from quotation selection.' },
        ...filters,
      ],
      undefined,
      200,
      'Returns every active item-size option in the authenticated user branch. If the company has an approved contract currently in effect, each size with a currently valid contract price uses CONTRACT pricing; active sizes not present in that contract use normal pricing. If no current contract exists, SISTER_COMPANY pricing is used when the company is marked as a sister company; otherwise PRIMARY pricing is used. The companyId must belong to the authenticated branch.'
    ),
  },
  [`${root}/items/sizes`]: {
    get: operation('List active sizes across items in the current branch', 'ItemSizeListResponse', filters, undefined, 200, 'itemId is optional. Includes variants without a size as size=null; hide the size selector for these variants. A size text filter matches only named sizes. Includes item and item.service. Missing or inactive standard prices are null with priceStatus=UNAVAILABLE.'),
    post: operation('Add reusable size reference', 'ItemSizeResponse', [], 'AddItemSizeRequest', 201, 'Send size=null to add a variant without a size, including for existing items. A size=null variant marks a direct-price item. Additional sizes are rejected with 409. Direct-price and named-size variants cannot be mixed, including at creation. Soft deletion does not allow switching modes; an inactive direct-price variant can only be replaced by another size=null variant. itemVersion is the latest parent item version. Returns the new itemVersion. No prices are accepted. Standard and company contract prices reuse this size ID. A previously inactive size name may be reused with a new ID.'),
  },
  [`${root}/items/sizes/{itemSizeId}`]: {
    get: operation('Get size including raw price and current versions', 'CatalogSizeDetailResponse', [path('itemSizeId')]),
    delete: operation('Deactivate size and its active prices', 'ItemSizeResponse', [path('itemSizeId')], 'CatalogVersionRequest', 200, 'Atomically deactivates standard prices. Company contract prices and their snapshots remain unchanged and can be used by currently valid contracts. The parent item remains active; its version increments for the child change. Each changed row receives an audit entry.'),
  },
  [`${root}/items/sizes/{itemSizeId}/price`]: {
    post: operation('Create missing standard price', 'CatalogItemPriceResponse', [path('itemSizeId')], 'CatalogPriceRequest', 201),
    patch: operation('Update active standard price using its version', 'CatalogItemPriceResponse', [path('itemSizeId')], 'UpdateCatalogPriceRequest'),
  },
  [`${root}/items/sizes/{itemSizeId}/contract-prices`]: {
     post: operation('Create size price for a company contract', 'CompanyContractPriceResponse', [path('itemSizeId')], 'CreateContractPriceRequest', 201, 'The item size and contract must belong to the authenticated user branch. Prices may be added only to DRAFT, REJECTED, SUBMITTED or APPROVED contracts. DRAFT and REJECTED allow any MARKETING-section role; SUBMITTED and APPROVED require ADMIN with MARKETING section. One active price per contract/item size is allowed. Maintenance price is required for services with maintenance. Parent contract version increments.'),
  },
  [`${root}/items/contract-prices/{contractPriceId}`]: {
    patch: operation('Update contract price (status-based permissions)', 'CompanyContractPriceResponse', [path('contractPriceId')], 'UpdateContractPriceRequest', 200, 'The contract must belong to the authenticated user branch. DRAFT and REJECTED require any MARKETING-section role; SUBMITTED and APPROVED require ADMIN with MARKETING section. Requires the current price version and records contract-price and contract history.'),
    delete: operation('Deactivate contract price using its version', 'CompanyContractPriceResponse', [path('contractPriceId')], 'CatalogVersionRequest', 200, 'Soft deletion follows the same status-based permissions as creation: DRAFT and REJECTED require any MARKETING-section role; SUBMITTED and APPROVED require ADMIN with MARKETING section. Branch ownership is always enforced.'),
  },
  [`${root}/company-contract-prices`]: {
    get: operation('List company contract prices in the current branch', 'CompanyContractPriceListResponse', [
      parameter('contractId', uuid), parameter('companyId', uuid), parameter('itemSizeId', uuid), parameter('isActive', { type: 'string', enum: ['true', 'false'] }), parameter('search', { type: 'string' }),
      parameter('sortBy', { type: 'string', enum: ['priceService', 'priceMaintenance', 'effectiveFrom', 'effectiveUntil', 'createdAt', 'updatedAt'] }), parameter('sortOrder', { type: 'string', enum: ['asc', 'desc'], default: 'desc' }), ...pagination,
    ], undefined, 200, 'Returns only active contract prices (isActive=true) belonging to the authenticated user branch. Inactive contract items are hidden from this list and can only appear as options in the contract-price-options endpoint for re-adding. Pagination counts follow the active-only filter. Contract date and status filters are independent of price activity.'),
  },
  [`${root}/items/sizes/contract-price-options/{contractId}`]: { get: operation('List item sizes available for one-by-one contract pricing', 'ContractPriceOptionListResponse', [path('contractId'), ...filters], undefined, 200, 'Reads all active item sizes in the authenticated user branch, then excludes sizes that already have a row in the requested contract. The response contains only size identity, item name and service name; price variants are not returned. The requested contract must belong to the authenticated branch.' ) },

  [`${root}/company-contracts`]: {
    get: operation('List company contracts in the current branch', 'CompanyContractListResponse', [parameter('companyId', uuid), parameter('status', contractStatus), ...pagination], undefined, 200, 'Branch-scoped list. Lifecycle statuses are DRAFT, SUBMITTED, REJECTED, APPROVED, REVISED and TERMINATED; soft-deleted rows remain auditable but are not part of the active lifecycle.'),
    post: operation('Create company contract', 'CompanyContractResponse', [], 'CreateCompanyContractRequest', 201, 'Creates DRAFT, stores an immutable company snapshot, and rejects concurrent DRAFT or current/future APPROVED contracts for the company.'),
  },
  [`${root}/company-contracts/{contractId}`]: {
    get: operation('Get company contract', 'CompanyContractResponse', [path('contractId')]),
    patch: operation('Update company contract', 'CompanyContractResponse', [path('contractId')], 'UpdateCompanyContractRequest', 200, 'DRAFT may be updated by all MARKETING roles in the same branch. APPROVED may be updated only by ADMIN in MARKETING. Approved and terminated intervals may not overlap.'),
    delete: operation('Soft delete a draft or rejected company contract', 'CompanyContractResponse', [path('contractId')], 'CatalogVersionRequest', 200, 'Sets isDeleted=true only for DRAFT or REJECTED contracts in the current branch and records history. Returns 409 for an already deleted contract or stale version. Approved contracts must use termination instead.'),
  },
  [`${root}/company-contracts/{contractId}/history`]: {
    get: operation('Read company contract history', 'CompanyContractHistoryResponse', [path('contractId'), ...pagination], undefined, 200, 'Returns append-only contract snapshots ordered by newest version. Access is restricted to the authenticated user branch and history remains available for soft-deleted contracts.'),
  },
  [`${root}/company-contracts/{contractId}/revise`]: {
    post: operation('Revise company contract', 'CompanyContractResponse', [path('contractId')], 'ReviseCompanyContractRequest', 201, 'Creates a DRAFT revision. Approval closes the original one day before the new effectiveFrom and marks it REVISED.'),
  },
  [`${root}/company-contracts/{contractId}/submit`]: { post: operation('Submit company contract', 'CompanyContractResponse', [path('contractId')], 'CatalogVersionRequest', 200, 'Changes DRAFT or REJECTED to SUBMITTED. The contract must contain at least one active contract item price. Marketing USER or ADMIN may submit within the authenticated branch.') },
  [`${root}/company-contracts/{contractId}/reject`]: { post: operation('Reject submitted company contract', 'CompanyContractResponse', [path('contractId')], 'CatalogVersionRequest', 200, 'Changes SUBMITTED to REJECTED. Only ADMIN in MARKETING may reject within the authenticated branch.') },

  [`${root}/company-contracts/{contractId}/terminate`]: {
    post: operation('Terminate approved company contract', 'CompanyContractResponse', [path('contractId')], 'TerminateCompanyContractRequest', 200, 'Soft-terminates an APPROVED contract and stores the requested effectiveUntil.'),
  },
  [`${root}/company-contract-prices/{contractPriceId}/history`]: {
    get: operation('Read user-friendly company contract price history', 'CompanyContractPriceHistoryResponse', [path('contractPriceId'), ...pagination], undefined, 200, 'Returns field-level changes with English labels, values before/after, actor, and timestamp. Only the current branch may read the history.'),
  },
  [`${root}/company-contracts/{contractId}/approve`]: {
    post: operation('Approve company contract (ADMIN/MARKETING)', 'CompanyContractResponse', [path('contractId')], 'CatalogVersionRequest', 200, 'Changes a DRAFT contract to APPROVED. Only ADMIN users in MARKETING may approve within the same branch.'),
  },
};
