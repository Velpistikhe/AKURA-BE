const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date' };
const timestamp = { type: 'string', format: 'date-time' };
const version = { type: 'integer', minimum: 0, maximum: 2147483646 };
const status = { type: 'string', enum: ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'], default: 'DRAFT' };
const inspectorNames = { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 255 }, description: 'Inspector names in display order. Case-insensitive duplicates are rejected. PATCH replaces the full list; [] clears it.' };
const inspectorPairs = { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['userId', 'name'], properties: { userId: uuid, name: { type: 'string', minLength: 1, maxLength: 255 } } }, description: 'Inspector user pairs in display order, taken verbatim from GET /api/v1/fieldservice/options/inspectors for the authenticated branch (each item is a raw Auth user snapshot from the FieldServiceUser read model; send its id as userId and firstName+lastName as name). At least one inspector is required for every creation, quotation or contract basis. After all other validations pass, Field Service re-validates every pair inside the same creation transaction against the FieldServiceUser snapshot of the authenticated branch: the submitted name must exactly equal the snapshot display name (firstName lastName), and stores the confirmed userId and name in the Work Order. Unknown IDs, IDs outside the branch, or names that no longer match the snapshot return 400. Duplicate userId values are rejected. The Work Order is always created with status DRAFT.' };
const fields = {
  contractId: { ...uuid, nullable: true, writeOnly: true, description: 'Contract reference, fetched live from Marketing when supplied.' },
  quotationId: { ...uuid, nullable: true, description: 'APPROVED quotation fetched live from Marketing when supplied.' },
  performaInvoiceId: { ...uuid, nullable: true, description: 'Performa invoice reference ID.' },
  startDate: date, endDate: { ...date, nullable: true, description: 'Must be on or after startDate. Required when quotationId is supplied.' },
  status: { ...status, description: 'PATCH accepts DRAFT, COMPLETED and CANCELED only. IN_PROGRESS is rejected (400): use POST /{id}/start, which re-validates the inspector snapshot against Auth and the quotation snapshot against Marketing first.' }, inspectors: inspectorNames,
};
const envelope = (data: object) => ({ type: 'object', properties: { status: { type: 'integer' }, success: { type: 'boolean' }, message: { type: 'string' }, requestId: { type: 'string' }, data } });
// Create never accepts status; the server stores DRAFT, and DRAFT -> IN_PROGRESS only via POST /{id}/start.
// Create takes inspector { userId, name } pairs (re-validated and stored server-side);
// PATCH keeps the display-name array contract.
const { status: _createStatus, ..._patchFields } = fields;
const createFields = { ..._patchFields, endDate: { ...date, description: 'Optional for contract/performa basis; required for quotation basis. Null is rejected on creation.' }, inspectors: inspectorPairs, items: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['itemSizeId','quantityInspection','quantityMaintenance'], properties: { itemSizeId: uuid, quantityInspection:{type:'number',minimum:0,maximum:999999999999.999,multipleOf:0.001}, quantityMaintenance:{type:'number',minimum:0,maximum:999999999999.999,multipleOf:0.001} } } } };
const { inspectors: _listInspectors, startDate: _listStartDate, endDate: _listEndDate, ..._listBaseFields } = fields;
const workOrderListRowFields = { ..._listBaseFields, startDate: date, endDate: { ...date, nullable: true } };
export const workOrderSchemas = {
  WorkOrderItem: { type: 'object', required: ['id', 'workOrderId', 'itemSizeId', 'item', 'quantityInspection', 'quantityMaintenance'], properties: {
    id: uuid, workOrderId: uuid, itemSizeId: uuid,
    item: { type: 'object', additionalProperties: false, required: ['itemSizeId', 'serviceName', 'inspectionScope', 'maintenanceScope', 'itemName', 'size'], properties: {
      itemSizeId: uuid, serviceName: { type: 'string' },
      inspectionScope: { type: 'string', description: 'Active inspection scopes of the size, joined with a comma.' },
      maintenanceScope: { type: 'string', description: 'Active maintenance scopes of the size, joined with a comma.' },
      itemName: { type: 'string' }, size: { type: 'string', nullable: true, description: 'Null for a size without a variant.' },
    }, readOnly: true, description: 'Item description snapshotted by Field Service. A quotation basis takes it from the live Marketing quotation line; another basis reads it from the Marketing item-size reference. It is never accepted from the client.' },
    quantityInspection: { type: 'string', format: 'decimal', pattern: '^\\d{1,12}(\\.\\d{1,3})?$' },
    quantityMaintenance: { type: 'string', format: 'decimal', pattern: '^\\d{1,12}(\\.\\d{1,3})?$' },
  } },
  WorkOrderLookupResponse: envelope({ type: 'object', nullable: true, required: ['id', 'quotationId', 'officeBranchId', 'revoked', 'number', 'status', 'version'], properties: {
    id: uuid, quotationId: uuid, officeBranchId: uuid, revoked: { type: 'boolean' }, number: { type: 'string' }, status, version,
  } }),
  WorkOrderCreate: { type: 'object', additionalProperties: false, required: ['startDate', 'inspectors', 'items'], anyOf: [{ required: ['quotationId'] }, { required: ['contractId'] }, { required: ['performaInvoiceId'] }], properties: createFields,
    example: { quotationId: '00000000-0000-4000-8000-000000000001', startDate: '2026-09-15', endDate: '2026-09-18', inspectors: [
      { userId: '00000000-0000-4000-8000-0000000000a1', name: 'Budi Santoso' },
      { userId: '00000000-0000-4000-8000-0000000000a2', name: 'Agus Wijaya' },
    ], items: [{ itemSizeId:'00000000-0000-4000-8000-000000000002', quantityInspection:1,quantityMaintenance:0 }] },
    description: 'Creates a Work Order with status DRAFT. Every item contains only itemSizeId, quantityInspection and quantityMaintenance. When quotationId is supplied, Field Service fetches the approved quotation from Marketing, validates its branch and builds each WorkOrderItem.item from the quotation description/scopes; the other bases resolve the item size from Marketing. Client-supplied descriptions are rejected. Inspector IDs are checked against branch snapshots.' },
  WorkOrderUpdate: { type: 'object', additionalProperties: false, required: ['version'], minProperties: 2, properties: { ...fields, version } },
  WorkOrderDelete: { type: 'object', additionalProperties: false, required: ['version'], properties: { version } },
  WorkOrderStart: {
    type: 'object', additionalProperties: false, required: ['version'], properties: { version },
    description: 'Optimistic-lock version of the DRAFT Work order to start.',
    example: { version: 3 },
  },
  WorkOrderQuotationSnapshot: {
    type: 'object', readOnly: true,
    description: 'Quotation content captured from the Marketing quotation reference when the Work Order was written. Deliberately free of every price: the header tax, subTotal, taxAmount and total are absent, and each item carries only its description and quantities. Identity and lifecycle fields are kept so the start transition can detect snapshot drift against the live Marketing quotation.',
    properties: {
      id: uuid, officeBranchId: uuid, no: { ...version, nullable: true, description: 'Quotation number; assigned only at approval, null before it.' },
      numberYear: { ...version, nullable: true, description: 'Number year; assigned only at approval, null before it.' }, revision: { ...version },
      date: { ...timestamp, nullable: true }, inquiryDate: timestamp, inquiryMethod: { type: 'string', enum: ['EMAIL', 'WHATSAPP', 'VERBAL', 'JOB_ORDER_REQUEST'] },
      jobStart: { type: 'string' }, subject: { type: 'string' }, termOfPayment: { type: 'string' }, validity: { type: 'string', description: 'Free-text validity of the quotation.' },
      supplyAkura: { type: 'string' }, supplyCustomer: { type: 'string' }, location: { type: 'string' }, accomplished: { type: 'string' },
      deliveryReports: { type: 'string' }, deliveryInvoice: { type: 'string' },
      customerSnapshot: { type: 'string' }, companySnapshot: { type: 'object', additionalProperties: true }, staffId: uuid,
      status: { type: 'string', enum: ['CREATED', 'SUBMITTED', 'REJECTED', 'APPROVED', 'REVISED', 'CONFIRMED', 'ON_PROGRESS', 'WORK_ORDER_COMPLETE', 'COMPLETE'] },
      isActive: { type: 'boolean' }, version, createdAt: timestamp, updatedAt: timestamp,
      items: { type: 'array', items: { type: 'object', description: 'Quotation items without any price.',
        properties: { id: uuid, itemSizeId: uuid, position: { type: 'integer' }, serviceName: { type: 'string' },
          serviceType: { type: 'string' }, itemName: { type: 'string' }, size: { type: 'string', nullable: true }, note: { type: 'string', nullable: true },
          quantityInspection: { type: 'string' }, quantityMaintenance: { type: 'string' }, isActive: { type: 'boolean' }, version } } },
    } },
  WorkOrderContractSnapshot: {
    type: 'object', readOnly: true,
    description: 'Contract content captured from the Marketing contract reference when the Work Order was written: the contract number, date, effective period, company identity and version only. Contract prices and the full company record are never stored.',
    required: ['id', 'version', 'contractNumber', 'contractDate', 'effectiveFrom', 'effectiveUntil', 'companyId', 'companyName'],
    properties: {
      id: uuid, version, contractNumber: { type: 'string' }, contractDate: timestamp,
      effectiveFrom: { ...timestamp, description: 'First day of the contract, inclusive.' },
      effectiveUntil: { ...timestamp, description: 'Last day of the contract, exclusive.' },
      companyId: uuid, companyName: { type: 'string' },
    } },
  WorkOrder: { type: 'object', properties: { ...fields,
    items: { type: 'array', items: ref('WorkOrderItem') },
    id: uuid, officeBranchId: { ...uuid, readOnly: true },
    number: { type: 'string', readOnly: true, example: 'WO/2026/000001' },
    date: { ...timestamp, readOnly: true, description: 'Current Asia/Jakarta calendar day, serialized as UTC midnight.' },
    startDate: timestamp, endDate: { ...timestamp, nullable: true },
    contractId: { ...uuid, nullable: true, readOnly: true },
    contractSnapshot: { type: 'object', nullable: true, readOnly: true, allOf: [ref('WorkOrderContractSnapshot')], description: 'Reduced contract JSON captured when the Work Order referenced the contract; the contract version lives inside this snapshot.' },
    quotationSnapshot: { type: 'object', nullable: true, readOnly: true, allOf: [ref('WorkOrderQuotationSnapshot')], description: 'Reduced quotation JSON captured when the Work Order referenced the quotation; it holds no price.' },
    revoked: { type: 'boolean', readOnly: true }, version,
    createdById: uuid, createdByName: { type: 'string' }, updatedById: { ...uuid, nullable: true }, updatedByName: { type: 'string', nullable: true },
    createdAt: timestamp, updatedAt: timestamp,
    inspectors: { type: 'array', items: { type: 'object', properties: { id: uuid, workOrderId: uuid, userId: { ...uuid, nullable: true, description: 'Auth user ID resolved from the FieldServiceUser read model at creation; null only for legacy name-based rows.' }, name: { type: 'string', description: 'Display-name snapshot (firstName lastName).' }, position: { type: 'integer' } } } },
  } },
  WorkOrderHistoryChange: { type: 'object', required: ['field', 'label', 'before', 'after'],
    description: 'One changed field, with an English user-facing label. Values may be null, scalar, object or array. Inspector changes contain ordered names.',
    properties: { field: { type: 'string', example: 'inspectors' }, label: { type: 'string', example: 'Inspectors' }, before: { nullable: true, example: ['Budi Santoso'] }, after: { nullable: true, example: ['Budi Santoso', 'Agus Wijaya'] } },
    example: { field: 'status', label: 'Status', before: 'DRAFT', after: 'IN_PROGRESS' } },
  WorkOrderHistory: { type: 'object', readOnly: true,
    required: ['id', 'workOrderId', 'version', 'action', 'actionLabel', 'beforeSnapshot', 'snapshot', 'changes', 'createdById', 'createdByName', 'createdAt', 'changedBy', 'changedAt'],
    properties: {
    id: uuid, workOrderId: uuid, version, action: { type: 'string', enum: ['CREATE', 'UPDATE', 'START', 'REVOKE'] }, actionLabel: { type: 'string', example: 'Work order deleted' },
    beforeSnapshot: { type: 'object', allOf: [ref('WorkOrder')], nullable: true, description: 'Full Work Order and inspector snapshot before the change; null for CREATE.' }, snapshot: { allOf: [ref('WorkOrder')], description: 'Full Work Order and inspector snapshot after the change.' },
    changes: { type: 'array', items: ref('WorkOrderHistoryChange'), description: 'Only fields whose values changed, each with an English label. Inspector names and order are compared; regenerated IDs are excluded.' },
    createdById: { ...uuid, description: 'ID of the user who performed this action.' }, createdByName: { type: 'string', example: 'Budi Santoso', description: 'Actor name captured at the time of the action.' }, createdAt: { ...timestamp, description: 'Time this history entry was recorded.' },
    changedBy: { type: 'object', required: ['id', 'name'], properties: { id: uuid, name: { type: 'string' } } }, changedAt: timestamp,
  } },
  WorkOrderHistoryResponse: envelope({ type: 'object', required: ['history', 'pagination'], properties: { history: { type: 'array', items: ref('WorkOrderHistory') }, pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } } } }),
  WorkOrderResponse: envelope(ref('WorkOrder')),
  WorkOrderList: envelope({ type: 'object', required: ['workOrders', 'pagination'], properties: { workOrders: { type: 'array', items: { type: 'object', description: 'List row includes quotationNo, quotationDate, contractNumber, contractDate, companyId and company from stored snapshots (null when unavailable), and omits inspectors, quotationSnapshot and contractSnapshot; date fields are date-only strings.', properties: { ...workOrderListRowFields, quotationNo: { type: 'integer', nullable: true }, quotationDate: { ...date, nullable: true }, contractNumber: { type: 'string', nullable: true }, contractDate: { ...date, nullable: true }, companyId: { ...uuid, nullable: true }, company: { type: 'string', nullable: true }, id: uuid, officeBranchId: uuid, number: { type: 'string' }, date, contractId: { ...uuid, nullable: true }, revoked: { type: 'boolean' }, version, createdById: uuid, createdByName: { type: 'string' }, updatedById: { ...uuid, nullable: true }, updatedByName: { type: 'string', nullable: true }, createdAt: timestamp, updatedAt: timestamp } } }, pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } } } }),
  FieldServiceUserSnapshot: {
    description: 'Raw Auth user snapshot synchronized into the FieldServiceUser read model (the exact JSON stored per row; future Auth field additions appear without a schema change).',
    type: 'object', additionalProperties: true,
    required: ['id', 'username', 'firstName', 'lastName', 'role', 'section', 'officeBranchId', 'isActive', 'version', 'createdAt', 'updatedAt'],
    properties: {
      id: uuid, username: { type: 'string', example: 'budi' },
      firstName: { type: 'string', example: 'Budi' }, lastName: { type: 'string', example: 'Santoso' },
      email: { type: 'string', format: 'email', nullable: true }, telp: { type: 'string', nullable: true },
      role: { type: 'string', enum: ['USER', 'ADMIN', 'APP_MANAGER'] },
      section: { type: 'string', nullable: true, enum: ['ACCOUNTING', 'FINANCE', 'HRD_MANAGEMENT', 'MARKETING', 'FIELD_SERVICE'] },
      officeBranchId: uuid, isActive: { type: 'boolean' }, version: version,
      createdAt: timestamp, updatedAt: timestamp,
    } },
  InspectorOptionList: envelope({ type: 'object', required: ['inspectors'], properties: { inspectors: { type: 'array', items: ref('FieldServiceUserSnapshot') } } }),
  QuotationOption: { type: 'object', required: ['id', 'subject'], properties: {
    id: uuid, number: { ...version, nullable: true, description: 'Quotation number; null until approved numbering.' },
    numberYear: { ...version, nullable: true, description: 'Number year; null until approved numbering.' },
    subject: { type: 'string', example: 'Inspection of storage tanks' },
    company: { type: 'object', nullable: true, additionalProperties: true, description: 'Company snapshot captured at approval.' },
    quotationVersion: { ...version, description: 'Quotation version at approval.' },
    revision: { ...version, description: 'Revision counter of the approved quotation.' },
    approvedAt: { ...timestamp, nullable: true, description: 'Approval time of the quotation PDF document.' } } },
  QuotationOptionList: envelope({ type: 'object', required: ['quotations'], properties: { quotations: { type: 'array', items: ref('QuotationOption') } } }),
  QuotationOptionItem: {
    type: 'object', required: ['itemSizeId', 'itemName'], additionalProperties: false,
    description: 'Active quotation line projected for the Work Order creation form. Price fields are excluded by construction.',
    properties: {
      itemSizeId: uuid,
      serviceName: { type: 'string', description: 'Service name of the line; empty for a standalone item.' },
      serviceType: { type: 'string', description: 'Upstream service type of the line.' },
      itemName: { type: 'string' },
      size: { type: 'string', nullable: true },
      quantityInspection: { type: 'string', format: 'decimal', description: 'Quotation inspection quantity; reference default only, the client submits its own quantities.' },
      quantityMaintenance: { type: 'string', format: 'decimal', description: 'Quotation maintenance quantity; reference default only.' },
      inspectionScope: { type: 'string' },
      maintenanceScope: { type: 'string' },
    },
  },
  QuotationOptionDetail: envelope({
    type: 'object', required: ['quotation'], properties: { quotation: {
      type: 'object', required: ['id', 'subject', 'items'], additionalProperties: false,
      properties: {
        id: uuid, no: { ...version, nullable: true }, numberYear: { ...version, nullable: true },
        subject: { type: 'string' }, company: { type: 'object', nullable: true, additionalProperties: true },
        items: { type: 'array', items: ref('QuotationOptionItem') },
      },
    } },
  }),
};
const id = { in: 'path', name: 'id', required: true, schema: uuid };
const quotationId = { in: 'path', name: 'quotationId', required: true, schema: uuid };
const operation = (summary: string, response: string, parameters: object[], body?: string, code = 200) => ({
  summary, tags: ['Work Order'], security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters,
  description: 'Work Order. Requires an active profile with matching authenticated branch. Creation uses the active profile and branch access guard: MARKETING/FIELD_SERVICE sections or ADMIN/APP_MANAGER roles. DELETE/start require section MARKETING. PATCH permits sections MARKETING and FIELD_SERVICE. ADMIN/APP_MANAGER roles do not bypass write section restrictions. GET permits MARKETING/FIELD_SERVICE sections and ADMIN/APP_MANAGER roles. Section is verified through Auth. The server generates number WO/YYYY/000001 and date in Asia/Jakarta; number counters restart each year independently per branch. number, date, branch and audit fields cannot be submitted or changed. At least one document basis is required: APPROVED quotationId (including contract-priced quotations) or contractId, both resolved live from the Marketing references (the payload carries IDs only; quotation content, contract content and their versions are never submitted) or performaInvoiceId (stored as an ID only). When multiple IDs are supplied, quotation takes precedence over contract, then performa invoice. References are validated for the authenticated branch, for an APPROVED and active quotation, and for an APPROVED contract inside its effective period (end exclusive). The stored snapshot is reduced: quotationSnapshot keeps quotation identity and descriptive content with items but no price, contractSnapshot keeps contract number, date, effective period and company identity only. Creation with quotationId requires startDate and endDate. Every creation requires the inspectors array of { userId, name } pairs copied from the inspector options snapshot, with at least one pair (an empty array is rejected with 400), each re-validated against the local FieldServiceUser read model of the authenticated branch (the name must equal the snapshot display name; the confirmed userId and name are stored at write time). PATCH keeps the inspector names array contract. Creation without a basis and clearing the basis on PATCH are rejected. A quotation may back only one live Work Order per branch: creating a Work Order, or replacing the basis on PATCH, while another non-revoked Work Order already references the same quotation returns 409; revoking that Work Order (DELETE) frees the quotation again. Replacing the basis clears the opposite reference and captures a new snapshot; omitted basis fields preserve the stored snapshot. PATCH/DELETE/start require the current version; conflicts and revoked writes return 409. PATCH rejects status IN_PROGRESS: DRAFT to IN_PROGRESS happens only via POST /{id}/start, which re-validates the stored inspector snapshot and quotation snapshot live against Auth and Marketing before the transition. Inspectors are saved atomically with the Work Order. An inspector may hold only one overlapping Work Order per branch: creation and PATCH both return 409 when a submitted or already stored inspector is booked in an overlapping period, and the edited Work Order itself is excluded from that check. DELETE is a soft delete (sets revoked=true) and retains inspectors and allocated numbers. Detail can read revoked work orders within the branch.',
  ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: ref(body) } } } } : {}),
  responses: { [code]: { description: 'Success', content: { 'application/json': { schema: ref(response) } } },
    400: { description: 'Invalid fields, dates, inspector names, or an empty inspector array' }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Access denied' }, 404: { description: 'Work Order, contract or quotation not found in this branch' }, 409: { description: 'Version conflict, revoked Work Order, quotation already backs another non-revoked Work Order in this branch, an inspector already has an overlapping work order, or number limit reached' }, 502: { description: 'Invalid upstream response' }, 503: { description: 'Referenced service unavailable' } },
});
const query = (name: string, schema: object) => ({ in: 'query', name, schema });
export const workOrderPaths = {
  '/api/v1/marketing/company-contract-references/{companyId}': {
    get: { summary: 'Resolve active contract by company', tags: ['Company Contracts'], security: [{bearerAuth:[]},{accessTokenCookie:[]}],
      description: 'Branch-scoped reference access for document consumers. Returns the single APPROVED contract effective today in Asia/Jakarta (end exclusive), company snapshot and active prices. Marketing is the source of truth for the status and effective period.',
      parameters: [{in:'path',name:'companyId',required:true,schema:uuid}],
      responses: {200:{description:'Contract reference'},400:{description:'Invalid company ID'},401:{description:'Unauthenticated'},403:{description:'Access denied'},404:{description:'Company not found'},409:{description:'No eligible contract or multiple eligible contracts'}} },
  },
  '/api/v1/marketing/contract-references/{contractId}': {
  get: { summary: 'Read company contract reference', tags: ['Company Contracts'], security: [{bearerAuth:[]},{accessTokenCookie:[]}],
    description: 'Read-only contract and company snapshot with active price rows for document consumers. Branch scoped; consumers validate status, version and effective period.',
    parameters: [{in:'path',name:'contractId',required:true,schema:uuid}],
    responses: {400:{description:'Invalid contract ID'},200:{description:'Contract reference',content:{'application/json':{schema:{type:'object',properties:{data:{type:'object',additionalProperties:true}}}}}},401:{description:'Unauthenticated'},403:{description:'Access denied'},404:{description:'Contract not found'}}
  }
},

  '/api/v1/fieldservice/work-orders/by-quotation/{quotationId}': {
    get: {
      ...operation('Find active Work Order by quotation', 'WorkOrderResponse', [quotationId]),
      description: 'Read-only lookup scoped to the authenticated actor branch. Allowed sections: MARKETING, FIELD_SERVICE, FINANCE and ACCOUNTING; existing ADMIN and APP_MANAGER access also applies. Finance and Accounting access is limited to this lookup and does not grant other Work Order operations.',
      responses: { 200: { description: 'Active Work Order found, or null when none exists', content: { 'application/json': { schema: ref('WorkOrderLookupResponse') } } }, 400: { description: 'Invalid quotation ID' }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Access denied' }, 502: { description: 'Invalid Auth profile response' }, 503: { description: 'Referenced service unavailable' } },
    },
  },
  '/api/v1/fieldservice/work-orders/{id}/history': {
    get: { ...operation('Read Work Order change history', 'WorkOrderHistoryResponse', [id, query('page', { type: 'integer', minimum: 1, maximum: 1000000, default: 1 }), query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 })]),
      description: 'Append-only CREATE/UPDATE/REVOKE history in descending version order, scoped to the authenticated branch. Available after revocation. Supports page (default 1) and limit (default 20, maximum 100); no request body. Includes before/after snapshots with inspectors, labeled field changes (field/label/before/after) and actor/actionLabel/changedAt. CREATE has beforeSnapshot=null. A Work Order without recorded changes returns an empty history array and total=0. History and each mutation commit atomically. Records existing before this feature start history at their next mutation; no historical events are invented.' },
  },
  '/api/v1/fieldservice/work-orders/invoices/from-quotation': {
    post: {
      summary: 'Create invoice or proforma invoice from a quotation', tags: ['Work Order'],
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters: [],
      description: 'Requires an active MARKETING actor in the authenticated branch (ADMIN/APP_MANAGER roles do not bypass section restrictions), matching the Field Service creation access policy. Body: quotationId UUID, kind INVOICE or PROFORMA_INVOICE, dueDate (YYYY-MM-DD), location, purchaseOrderNumber and purchaseOrderDate. Forwards the verified user token to Finance, which re-fetches and validates the active APPROVED quotation and Work Order completion, and creates a DRAFT document with quotation prices, purchase order data, audit history and server-generated number. Finance remains the source of truth.',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['quotationId', 'kind', 'dueDate', 'location', 'purchaseOrderNumber', 'purchaseOrderDate'], properties: { quotationId: uuid, kind: { type: 'string', enum: ['INVOICE', 'PROFORMA_INVOICE'] }, dueDate: date, location: { type: 'string', minLength: 1, maxLength: 255 }, purchaseOrderNumber: { type: 'string', minLength: 1, maxLength: 100 }, purchaseOrderDate: date }, example: { quotationId: '00000000-0000-4000-8000-000000000001', kind: 'INVOICE', dueDate: '2026-12-31', location: 'Jakarta', purchaseOrderNumber: 'PO/2026/000001', purchaseOrderDate: '2026-01-15' } } } } },
      responses: { 201: { description: 'DRAFT invoice or proforma invoice created' }, 400: { description: 'Invalid payload or deadline' }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Only MARKETING section can create documents via Field Service' }, 404: { description: 'Quotation not found in this branch' }, 409: { description: 'Quotation not approved, Work Order not completed, or duplicate invoice' }, 502: { description: 'Invalid upstream response' }, 503: { description: 'Finance Service unavailable' } },
    },
  },
  '/api/v1/fieldservice/work-orders': {
    get: operation('List Work Order', 'WorkOrderList', [query('page', { type: 'integer', minimum: 1, maximum: 1000000, default: 1 }), query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }), query('status', status), query('quotationId', uuid), query('contractId', uuid), query('revoked', { type: 'boolean', default: false }), query('search', { type: 'string', maxLength: 100 })]),
    post: {...operation('Create Work Order', 'WorkOrderResponse', [], 'WorkOrderCreate', 201), description: 'Requires actor section MARKETING, including ADMIN and APP_MANAGER actors. Other sections are rejected with 403. ' + operation('Create Work Order', 'WorkOrderResponse', [], 'WorkOrderCreate', 201).description},
  },
  '/api/v1/fieldservice/work-orders/{id}': {
    get: operation('Get Work Order', 'WorkOrderResponse', [id]),
    patch: operation('Update Work Order and inspectors', 'WorkOrderResponse', [id], 'WorkOrderUpdate'),
    delete: {
      ...operation('Revoke Work Order', 'WorkOrderResponse', [id], 'WorkOrderDelete'),
      description: 'Soft-revokes the Work Order and records REVOKE history. For quotation-based Work Orders, Field Service synchronously notifies Marketing before committing the revoke. If Marketing cannot clear the quotation Work Order link, the Field Service transaction is rolled back and the API returns an error; retry after Marketing is available.',
      responses: { 200: { description: 'Work Order revoked', content: { 'application/json': { schema: ref('WorkOrderResponse') } } }, 400: { description: 'Invalid ID or version' }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Access denied' }, 404: { description: 'Work Order not found' }, 409: { description: 'Work Order changed, is already revoked, is completed/canceled, or Marketing rejected the quotation link update' }, 502: { description: 'Invalid Auth response or Marketing revoke acknowledgment; revoke was rolled back' }, 503: { description: 'Marketing unavailable; revoke was rolled back' } },
    },
  },
  '/api/v1/fieldservice/work-orders/{id}/start': {
    post: {
      ...operation('Start Work Order (DRAFT to IN_PROGRESS)', 'WorkOrderResponse', [id], 'WorkOrderStart'),
      description: 'Moves a DRAFT Work Order to IN_PROGRESS and records a START history entry. Requires section MARKETING and the current version (optimistic lock). Before the transition the stored inspector snapshot is re-validated live against Auth through the branch-scoped inspector reference: Auth unavailable (network error, timeout or 5xx) returns 503 "Auth service is currently unavailable; retry later"; an inspector that no longer exists in Auth as an active FIELD_SERVICE user of the branch, or whose display name no longer matches the stored snapshot, returns 409 "Work order inspectors do not match Auth user data; reload the inspectors before starting". For quotation-based orders the server additionally re-validates the stored quotation snapshot against Marketing through the read-only quotation reference: Marketing is unavailable (network error, timeout or 5xx) returns 503 "Marketing service is currently unavailable; retry later"; a quotation that no longer matches Marketing (descriptive content changed, revised, deactivated, not APPROVED or removed; link bookkeeping changes to header version/updatedAt alone do not invalidate the snapshot) returns 409 "Work order quotation snapshot does not match Marketing data; reload the quotation". When both validations succeed the transition commits atomically (status, version increment, actor and history). Contract-based orders transition without quotation validation. Work Orders that are not DRAFT, stale versions and revoked orders return 409; unknown IDs return 404. PATCH cannot set IN_PROGRESS directly: this endpoint is the only way to start a Work Order. The upstream Auth and Marketing calls never run inside a database transaction.',
      responses: {
        200: { description: 'Work Order started (IN_PROGRESS)', content: { 'application/json': { schema: ref('WorkOrderResponse') } } },
        400: { description: 'Invalid version or quotation ID' },
        401: { description: 'Unauthenticated or stale branch' },
        403: { description: 'Access denied (section MARKETING required)' },
        404: { description: 'Work Order not found in this branch' },
        409: { description: 'Not a draft, stale version, revoked, inspector snapshot does not match Auth data, non-quotation basis mismatch, or quotation snapshot does not match Marketing data' },
        502: { description: 'Invalid Marketing response' },
        503: { description: 'Marketing service is currently unavailable; retry later' },
      },
    },
  },
  '/api/v1/fieldservice/options/inspectors': {
    get: {
      summary: 'List inspector options for the current branch', tags: ['Work Order'],
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters: [],
      description: 'Returns the raw Auth user snapshots of active users with section FIELD_SERVICE synchronized from Auth into the local FieldServiceUser read model: each array item is the complete snapshot JSON as stored (id, username, firstName, lastName, email, telp, role, section, officeBranchId, isActive, version, createdAt, updatedAt and any future Auth fields). Requires an active profile and current authenticated branch; records from other branches are never included. Ordered by user creation time then ID, limited to 500 rows. Copy each item id as userId and firstName+lastName as name when creating a Work Order.',
      responses: { 200: { description: 'Branch-scoped inspector options', content: { 'application/json': { schema: ref('InspectorOptionList') } } }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Access denied' }, 502: { description: 'Invalid upstream response or branch mismatch' }, 503: { description: 'Referenced service unavailable' } },
    },
  },
  '/api/v1/fieldservice/options/quotations': {
    get: {
      summary: 'List approved quotation options for the current branch', tags: ['Work Order'],
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters: [],
      description: 'Resolved live from Marketing GET /api/v1/marketing/quotation-references in a single upstream request. Returns active APPROVED quotations of the authenticated branch, including contract-priced quotations. Marketing unavailability returns 503. Requires an active profile and current authenticated branch.',
      responses: { 200: { description: 'Branch-scoped quotation options', content: { 'application/json': { schema: ref('QuotationOptionList') } } }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Access denied' }, 502: { description: 'Invalid upstream response or branch mismatch' }, 503: { description: 'Referenced service unavailable' } },
    },
  },
  '/api/v1/fieldservice/options/quotations/{quotationId}': {
    get: {
      summary: 'List quotation item options for the Work Order creation form', tags: ['Work Order'],
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }], parameters: [quotationId],
      description: 'Returns the APPROVED active quotation of the authenticated branch with its active item lines for the Work Order creation form. Each line exposes itemSizeId, description and the quotation quantities as reference defaults only; every price field of the quotation is excluded by an explicit allowlist projection. The quotation is fetched live from Marketing GET /api/v1/marketing/quotation-references/{quotationId}, so an unknown, inactive, non-APPROVED or other-branch quotation returns 404 and Marketing unavailability returns 503. Work Order creation still re-validates the quotation and rejects sizes outside it with 409.',
      responses: { 200: { description: 'Branch-scoped quotation detail with price-free item lines', content: { 'application/json': { schema: ref('QuotationOptionDetail') } } }, 400: { description: 'Invalid quotation ID' }, 401: { description: 'Unauthenticated or stale branch' }, 403: { description: 'Access denied' }, 404: { description: 'Quotation not found in this branch' }, 409: { description: 'Quotation is not an active APPROVED quotation' }, 502: { description: 'Invalid upstream response or branch mismatch' }, 503: { description: 'Referenced service unavailable' } },
    },
  },
};

