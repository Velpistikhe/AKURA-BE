const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date' };
const timestamp = { type: 'string', format: 'date-time' };
const version = { type: 'integer', minimum: 0, maximum: 2147483646 };
const status = { type: 'string', enum: ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'], default: 'DRAFT' };
const inspectorNames = { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 255 }, description: 'Inspector names in display order. Case-insensitive duplicates are rejected. PATCH replaces the full list; [] clears it.' };
const fields = {
  companyId: { ...uuid, nullable: true, writeOnly: true, description: 'Company in the authenticated branch. Server resolves its single ACTIVE contract effective today; mutually exclusive with quotationId and contractId.' },
  contractId: { ...uuid, nullable: true, writeOnly: true, description: 'Exact ACTIVE contract in the authenticated branch (validated through Marketing). Mutually exclusive with quotationId and companyId. The contract version is captured in contractSnapshot; it is not submitted.' },
  quotationId: { ...uuid, nullable: true, description: 'APPROVED quotation with normal/sister pricing in the current branch, resolved from the synchronized snapshot table (no live Marketing call and no version submitted). Mutually exclusive with contractId and companyId. To replace the basis, supply companyId or one quotation/contract ID.' },
  startDate: date, endDate: { ...date, nullable: true, description: 'Must be on or after startDate. Required when quotationId is supplied.' },
  status, inspectors: inspectorNames,
};
const envelope = (data: object) => ({ type: 'object', properties: { status: { type: 'integer' }, success: { type: 'boolean' }, message: { type: 'string' }, requestId: { type: 'string' }, data } });
// Create never accepts status; the server stores DRAFT and status changes are PATCH edits.
const { status: _createStatus, ...createFields } = fields;
export const workOrderSchemas = {
  WorkOrderCreate: { type: 'object', additionalProperties: false, required: ['startDate'], oneOf: [{required:['quotationId','endDate','inspectors'],properties:{quotationId:{...uuid,nullable:false},endDate:date,inspectors:inspectorNames,companyId:{enum:[null]},contractId:{enum:[null]}}},{required:['contractId'],properties:{contractId:{...uuid,nullable:false},quotationId:{enum:[null]},companyId:{enum:[null]}}},{required:['companyId'],properties:{companyId:{...uuid,nullable:false},quotationId:{enum:[null]},contractId:{enum:[null]}}}], properties: createFields,
    example: { companyId: '00000000-0000-4000-8000-000000000001', startDate: '2026-09-15', endDate: '2026-09-18', inspectors: ['Budi Santoso', 'Agus Wijaya'] },
    description: 'Creates a Work Order with status DRAFT (status is not accepted here). Supply exactly one basis: quotationId, contractId, or companyId resolved by the server. A quotation-based Work Order requires quotationId with startDate, endDate and the inspectors array; quotation content comes from the snapshot synchronized at approval, so quotation/contract versions and summary are never submitted. May be called by the frontend directly with the caller token, or forwarded by Marketing after a quotation is selected; POST requires section MARKETING.' },
  WorkOrderUpdate: { type: 'object', additionalProperties: false, required: ['version'], minProperties: 2, properties: { ...fields, version } },
  WorkOrderDelete: { type: 'object', additionalProperties: false, required: ['version'], properties: { version } },
  WorkOrder: { type: 'object', properties: { ...fields,
    id: uuid, officeBranchId: { ...uuid, readOnly: true },
    number: { type: 'string', readOnly: true, example: 'WO/2026/000001' },
    date: { ...timestamp, readOnly: true, description: 'Current Asia/Jakarta calendar day, serialized as UTC midnight.' },
    startDate: timestamp, endDate: { ...timestamp, nullable: true },
    contractId: { ...uuid, nullable: true, readOnly: true },
    contractSnapshot: {type:'object',nullable:true,additionalProperties:true,readOnly:true,description:'Full contract JSON captured when the Work Order referenced the contract; contractVersion lives inside this snapshot.'},
    quotationSnapshot: { type: 'object', additionalProperties: true, nullable: true, readOnly: true },
    revoked: { type: 'boolean', readOnly: true }, version,
    createdById: uuid, createdByName: { type: 'string' }, updatedById: { ...uuid, nullable: true }, updatedByName: { type: 'string', nullable: true },
    createdAt: timestamp, updatedAt: timestamp,
    inspectors: { type: 'array', items: { type: 'object', properties: { id: uuid, workOrderId: uuid, name: { type: 'string' }, position: { type: 'integer' } } } },
  } },
  WorkOrderHistoryChange: { type: 'object', required: ['field', 'label', 'before', 'after'],
    description: 'One changed field, with an English user-facing label. Values may be null, scalar, object or array. Inspector changes contain ordered names.',
    properties: { field: { type: 'string', example: 'inspectors' }, label: { type: 'string', example: 'Inspectors' }, before: { nullable: true, example: ['Budi Santoso'] }, after: { nullable: true, example: ['Budi Santoso', 'Agus Wijaya'] } },
    example: { field: 'status', label: 'Status', before: 'DRAFT', after: 'IN_PROGRESS' } },
  WorkOrderHistory: { type: 'object', readOnly: true,
    required: ['id', 'workOrderId', 'version', 'action', 'actionLabel', 'beforeSnapshot', 'snapshot', 'changes', 'createdById', 'createdByName', 'createdAt', 'changedBy', 'changedAt'],
    properties: {
    id: uuid, workOrderId: uuid, version, action: { type: 'string', enum: ['CREATE', 'UPDATE', 'REVOKE'] }, actionLabel: { type: 'string', example: 'Work order deleted' },
    beforeSnapshot: { type: 'object', allOf: [ref('WorkOrder')], nullable: true, description: 'Full Work Order and inspector snapshot before the change; null for CREATE.' }, snapshot: { allOf: [ref('WorkOrder')], description: 'Full Work Order and inspector snapshot after the change.' },
    changes: { type: 'array', items: ref('WorkOrderHistoryChange'), description: 'Only fields whose values changed, each with an English label. Inspector names and order are compared; regenerated IDs are excluded.' },
    createdById: { ...uuid, description: 'ID of the user who performed this action.' }, createdByName: { type: 'string', example: 'Budi Santoso', description: 'Actor name captured at the time of the action.' }, createdAt: { ...timestamp, description: 'Time this history entry was recorded.' },
    changedBy: { type: 'object', required: ['id', 'name'], properties: { id: uuid, name: { type: 'string' } } }, changedAt: timestamp,
  } },
  WorkOrderHistoryResponse: envelope({ type: 'object', required: ['history', 'pagination'], properties: { history: { type: 'array', items: ref('WorkOrderHistory') }, pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } } } }),
  WorkOrderResponse: envelope(ref('WorkOrder')),
  WorkOrderList: envelope({ type: 'object', properties: { workOrders: { type: 'array', items: ref('WorkOrder') }, pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } } } }),
  InspectorOption: { type: 'object', required: ['id', 'name'], properties: {
    id: uuid, name: { type: 'string', example: 'Budi Santoso', description: 'Full display name.' },
    username: { type: 'string', example: 'budi', description: 'Auth username of the inspector.' } } },
  InspectorOptionList: envelope({ type: 'object', required: ['inspectors'], properties: { inspectors: { type: 'array', items: ref('InspectorOption') } } }),
  QuotationOption: { type: 'object', required: ['id', 'subject'], properties: {
    id: uuid, number: { ...version, nullable: true, description: 'Quotation number; null until approved numbering.' },
    numberYear: { ...version, nullable: true, description: 'Number year; null until approved numbering.' },
    subject: { type: 'string', example: 'Inspection of storage tanks' },
    company: { type: 'object', nullable: true, additionalProperties: true, description: 'Company snapshot captured at approval.' },
    quotationVersion: { ...version, description: 'Quotation version at approval.' },
    revision: { ...version, description: 'Revision counter of the approved quotation.' },
    approvedAt: { ...timestamp, nullable: true, description: 'Approval time of the synchronized snapshot.' } } },
  QuotationOptionList: envelope({ type: 'object', required: ['quotations'], properties: { quotations: { type: 'array', items: ref('QuotationOption') } } }),
};
const id = { in: 'path', name: 'id', required: true, schema: uuid };
const operation = (summary: string, response: string, parameters: object[], body?: string, code = 200) => ({
  summary, tags: ['Work Order'], security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters,
  description: 'Work Order. Requires an active profile with matching authenticated branch. POST/DELETE require section MARKETING. PATCH permits sections MARKETING and FIELD_SERVICE. ADMIN/APP_MANAGER roles do not bypass write section restrictions. GET permits MARKETING/FIELD_SERVICE sections and ADMIN/APP_MANAGER roles. Section is verified through Auth. The server generates number WO/YYYY/000001 and date in Asia/Jakarta; number counters restart each year independently per branch. number, date, branch and audit fields cannot be submitted or changed. Exactly one document basis is required: APPROVED quotationId (resolved from the snapshot synchronized when the quotation was approved; quotation content and version are never submitted), contractId validated through the Marketing contract reference, or companyId resolved by the server to its single ACTIVE contract within its effective period (end exclusive). All bases must belong to the authenticated branch. Creation with quotationId requires startDate, endDate and the inspectors array. Creation without a basis and clearing the basis on PATCH are rejected. Replacing the basis clears the opposite reference and captures a new snapshot; omitted basis fields preserve the stored snapshot. PATCH/DELETE require the current version; conflicts and revoked writes return 409. Inspectors are saved atomically with the Work Order. DELETE is a soft delete (sets revoked=true) and retains inspectors and allocated numbers. Detail can read revoked work orders within the branch.',
  ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: ref(body) } } } } : {}),
  responses: { [code]: { description: 'Success', content: { 'application/json': { schema: ref(response) } } },
    400: { description: 'Invalid fields, dates or inspector names' }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Access denied' }, 404: { description: 'Work Order, company or quotation not found in this branch' }, 409: { description: 'No unique eligible contract, version conflict, revoked Work Order or number limit reached' }, 502: { description: 'Invalid upstream response' }, 503: { description: 'Referenced service unavailable' } },
});
const query = (name: string, schema: object) => ({ in: 'query', name, schema });
export const workOrderPaths = {
  '/api/v1/marketing/company-contract-references/{companyId}': {
    get: { summary: 'Resolve active contract by company', tags: ['Company Contracts'], security: [{bearerAuth:[]},{accessTokenCookie:[]}],
      description: 'Branch-scoped reference access for document consumers. Returns the single ACTIVE contract effective today in Asia/Jakarta (end exclusive), company snapshot and active prices.',
      parameters: [{in:'path',name:'companyId',required:true,schema:uuid}],
      responses: {200:{description:'Contract reference'},400:{description:'Invalid company ID'},401:{description:'Unauthenticated'},403:{description:'Access denied'},404:{description:'Company not found'},409:{description:'No eligible contract or multiple eligible contracts'}} },
  },
  '/api/v1/marketing/contract-references/{contractId}': {
  get: { summary: 'Read company contract reference', tags: ['Company Contracts'], security: [{bearerAuth:[]},{accessTokenCookie:[]}],
    description: 'Read-only contract and company snapshot with active price rows for document consumers. Branch scoped; consumers validate status, version and effective period.',
    parameters: [{in:'path',name:'contractId',required:true,schema:uuid}],
    responses: {200:{description:'Contract reference',content:{'application/json':{schema:{type:'object',properties:{data:{type:'object',additionalProperties:true}}}}}},401:{description:'Unauthenticated'},403:{description:'Access denied'},404:{description:'Contract not found'}}
  }
},

  '/api/v1/fieldservice/work-orders/{id}/history': {
    get: { ...operation('Read Work Order change history', 'WorkOrderHistoryResponse', [id, query('page', { type: 'integer', minimum: 1, maximum: 1000000, default: 1 }), query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 })]),
      description: 'Append-only CREATE/UPDATE/REVOKE history in descending version order, scoped to the authenticated branch. Available after revocation. Supports page (default 1) and limit (default 20, maximum 100); no request body. Includes before/after snapshots with inspectors, labeled field changes (field/label/before/after) and actor/actionLabel/changedAt. CREATE has beforeSnapshot=null. A Work Order without recorded changes returns an empty history array and total=0. History and each mutation commit atomically. Records existing before this feature start history at their next mutation; no historical events are invented.' },
  },
  '/api/v1/fieldservice/work-orders': {
    get: operation('List Work Order', 'WorkOrderList', [query('page', { type: 'integer', minimum: 1, maximum: 1000000, default: 1 }), query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }), query('status', status), query('quotationId', uuid), query('contractId', uuid), query('revoked', { type: 'boolean', default: false }), query('search', { type: 'string', maxLength: 100 })]),
    post: operation('Create Work Order', 'WorkOrderResponse', [], 'WorkOrderCreate', 201),
  },
  '/api/v1/fieldservice/work-orders/{id}': {
    get: operation('Get Work Order', 'WorkOrderResponse', [id]),
    patch: operation('Update Work Order and inspectors', 'WorkOrderResponse', [id], 'WorkOrderUpdate'),
    delete: operation('Revoke Work Order', 'WorkOrderResponse', [id], 'WorkOrderDelete'),
  },
  '/api/v1/fieldservice/options/inspectors': {
    get: {
      summary: 'List inspector options for the current branch', tags: ['Work Order'],
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters: [],
      description: 'Returns active users with section FIELD_SERVICE synchronized from Auth into the local read model. Requires an active profile and current authenticated branch; records from other branches are never included. Ordered by user creation time then ID.',
      responses: { 200: { description: 'Branch-scoped inspector options', content: { 'application/json': { schema: ref('InspectorOptionList') } } }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Access denied' } },
    },
  },
  '/api/v1/fieldservice/options/quotations': {
    get: {
      summary: 'List approved quotation options for the current branch', tags: ['Work Order'],
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters: [],
      description: 'Reads the local quotation snapshot table; no live Marketing request is made. Returns active APPROVED quotations in the authenticated branch, excluding contract-priced quotations because those must use the contract basis. Requires an active profile and current authenticated branch.',
      responses: { 200: { description: 'Branch-scoped quotation options', content: { 'application/json': { schema: ref('QuotationOptionList') } } }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Access denied' } },
    },
  },
  // Internal delivery uses the gateway with Marketing service credentials.
  '/api/v1/fieldservice/internal/quotation-snapshots/events': { post: {
    tags: ['Work Order'], summary: 'Internal: store an APPROVED quotation snapshot for Field Service', security: [],
    parameters: [
      { name: 'x-service-name', in: 'header', required: true, schema: { type: 'string', enum: ['marketing-service'] } },
      { name: 'x-service-secret', in: 'header', required: true, schema: { type: 'string' } },
      { name: 'x-quotation-sync-secret', in: 'header', required: true, schema: { type: 'string' } },
    ],
    description: 'Marketing service credentials and quotation sync secret required. The gateway injects the Field Service gateway secret. The complete approved quotation JSON is stored per branch and quotation, replacing an older snapshot atomically; duplicate or older versions are acknowledged without changing the stored row. Work Order creation then reads this snapshot instead of calling Marketing.',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['eventId','officeBranchId','quotationId','quotationVersion','version','revision','approvedAt','quotation'], properties: {
      eventId: { type: 'string', format: 'uuid' }, officeBranchId: { type: 'string', format: 'uuid' },
      quotationId: { type: 'string', format: 'uuid' }, quotationVersion: { type: 'integer', minimum: 0 },
      version: { type: 'integer', minimum: 1, description: 'Monotonic outbox event number for this quotation.' },
      revision: { type: 'integer', minimum: 0 }, approvedAt: { type: 'string', format: 'date-time' },
      quotation: { type: 'object', additionalProperties: true, description: 'Complete quotation JSON including items and price selections.' },
    } } } } },
    responses: { 200: { description: 'Acknowledged: {success:true,eventId}' }, 400: { description: 'Invalid event; stored snapshot unchanged' }, 403: { description: 'Invalid service credential' } },
  } },
};

