const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: 'string', format: 'uuid' };
const timestamp = { type: 'string', format: 'date-time' };
const text = { type: 'string', minLength: 1, maxLength: 255 };
const money = { type: 'string', format: 'decimal', example: '100.25' };
const header = {
  inquiryMethod: ref('InquiryMethod'),
  inquiryDate: { type: 'string', format: 'date' },
  subject: text, termOfPayment: text, validity: text,
  supplyAkura: text, supplyCustomer: text, location: text, accomplished: text, deliveryReports: text,
  companyId: { ...uuid, description: 'Selected company. Required when staffId is omitted. Not stored as an editable header; captured in companySnapshot.' },
  staffId: { ...uuid, nullable: true, description: 'Optional contact belonging to the selected company.' },
};
const audit = {
  createdById: { ...uuid, readOnly: true }, updatedById: { ...uuid, nullable: true, readOnly: true },
  createdAt: timestamp, updatedAt: timestamp,
};
const requiredHeader = ['inquiryMethod', 'inquiryDate', 'subject', 'termOfPayment', 'validity', 'supplyAkura', 'supplyCustomer', 'location', 'accomplished', 'deliveryReports'];
const envelope = (data: object) => ({
  type: 'object', required: ['status', 'success', 'message', 'data'],
  properties: { status: { type: 'integer' }, success: { type: 'boolean', enum: [true] }, message: { type: 'string' }, data, requestId: uuid },
});
export const quotationSchemas = {
  QuotationPdf: {
    type: 'object', readOnly: true,
    properties: {
      id: uuid, quotationId: uuid, bucket: { type: 'string' }, key: { type: 'string' }, fileName: { type: 'string' },
      contentType: { type: 'string', example: 'application/pdf' }, size: { type: 'integer', description: 'File size in bytes.' },
      sha256: { type: 'string' }, revision: { type: 'integer' }, version: { type: 'integer' },
      approvedAt: timestamp, approvedById: uuid, approvedByName: { type: 'string' }, createdAt: timestamp,
    },
  },
  ApproveQuotationRequest: {
    type: 'object', additionalProperties: false, required: ['version'],
    properties: { version: { type: 'integer', minimum: 0, maximum: 2147483646, example: 0 } },
  },
  ApproveQuotationResponse: envelope({ allOf: [ref('Quotation'), { type: 'object', properties: {
    pdf: { allOf: [ref('QuotationPdf'), { type: 'object', properties: { url: { type: 'string', format: 'uri' }, expiresAt: timestamp } }] },
  } }] }),
  QuotationPriceSelection: {
    type:'object',readOnly:true,description:'Server-generated source and version snapshot; never submitted by clients.',
    properties:{quantityModel:{type:'string',enum:['DUAL']},priceSource:{type:'string',enum:['CONTRACT','PRIMARY','SISTER_COMPANY']},priceId:uuid,priceVersion:{type:'integer'},contractId:{...uuid,nullable:true},contractVersion:{type:'integer',nullable:true},sizeVersion:{type:'integer'},itemVersion:{type:'integer'},serviceVersion:{type:'integer'}},
  },
  InvoiceStatus: {
    type: 'string', nullable: true, enum: ['CREATED', 'SEND', 'APPROVED', 'COMPLETE', 'CANCELED', 'EXPIRED', null],
    description: 'Invoice status managed by the server. Initialized to null on creation; not accepted in POST or PATCH requests.',
  },
  InquiryMethod: {
    type: 'string', enum: ['EMAIL', 'WHATSAPP', 'VERBAL', 'JOB_ORDER_REQUEST'],
    description: 'Inquiry channel. Values are case-sensitive.',
  },
  QuotationStatus: {
    type: 'string', enum: ['CREATED', 'SENT', 'REJECTED', 'APPROVED', 'REVISED', 'CONFIRMED', 'ON_PROGRESS', 'WORK_ORDER_COMPLETE', 'COMPLETE'],
    description: 'Quotation status. Managed by the server; initialized to CREATED on creation. Values are case-sensitive.',
  },
  QuotationItemInput: {
    type:'object',additionalProperties:false,required:['itemSizeId','quantityInspection'],
    description:'One row per size with two quantities. Maintenance may be omitted or zero; at least one quantity must be positive. Server fetches current company prices whenever items are submitted. Prices, source tokens and priceKind are rejected.',
    properties:{  itemSizeId:uuid,
      quantityInspection:{oneOf:[{type:'string',pattern:'^\\d{1,12}(\\.\\d{1,3})?$'},{type:'number',minimum:0,multipleOf:0.001,maximum:999999999999.999}],example:'2'},
      quantityMaintenance:{oneOf:[{type:'string',pattern:'^\\d{1,12}(\\.\\d{1,3})?$'},{type:'number',minimum:0,multipleOf:0.001,maximum:999999999999.999}],default:'0',example:'0'},
    },
  },
  CreateQuotationRequest: {
    type: 'object', additionalProperties: false, required: [...requiredHeader, 'items'],
    anyOf:[{required:['companyId']},{required:['staffId'],properties:{staffId:{...uuid,nullable:false}}}],
    properties: { ...header, items: { type: 'array', minItems: 1, maxItems: 100, items: ref('QuotationItemInput') } },
  },

  DeleteQuotationRequest: {
    type: 'object', additionalProperties: false, required: ['version'],
    properties: { version: { type: 'integer', minimum: 0, maximum: 2147483646, example: 0, description: 'Current quotation version returned by GET or POST. A stale version is rejected with 409.' } },
  },
  UpdateQuotationItemInput: {
    type:'object',additionalProperties:false,required:['itemSizeId','quantityInspection'],
    description:'One row per size with two quantities. Maintenance may be omitted or zero; at least one quantity must be positive. Server fetches current company prices whenever items are submitted. Prices, source tokens and priceKind are rejected.',
    properties:{ id:{...uuid,description:'Existing line ID. Omit for a new line.'}, itemSizeId:uuid,
      quantityInspection:{oneOf:[{type:'string',pattern:'^\\d{1,12}(\\.\\d{1,3})?$'},{type:'number',minimum:0,multipleOf:0.001,maximum:999999999999.999}],example:'2'},
      quantityMaintenance:{oneOf:[{type:'string',pattern:'^\\d{1,12}(\\.\\d{1,3})?$'},{type:'number',minimum:0,multipleOf:0.001,maximum:999999999999.999}],default:'0',example:'0'},
    },
  },
  UpdateQuotationRequest: {
    type: 'object', additionalProperties: false, required: ['version'], minProperties: 2,
    properties: {
      ...header,
      version: { type: 'integer', minimum: 0, maximum: 2147483646, description: 'Latest version returned by GET/POST/PATCH; required for every update.' },
      items: { type: 'array', minItems: 1, maxItems: 100, items: ref('UpdateQuotationItemInput'), description: 'Complete desired active item list. Existing IDs must be unique. Omitted old lines are soft-deleted.' },
    },
    example: { version: 0, subject: 'Revised inspection quotation' },
  },
  QuotationItem: {
    type: 'object', required: ['id', 'quotationId', 'itemSizeId', 'position', 'serviceName', 'serviceType', 'itemName', 'size', 'quantityInspection', 'quantityMaintenance', 'priceInspection', 'priceMaintenance', 'subTotal', 'isActive', ...Object.keys(audit)],
    properties: {
      id: uuid, quotationId: uuid, itemSizeId: uuid, position: { type: 'integer', minimum: 0 },
      serviceName: { type: 'string' }, serviceType: ref('ServiceType'), itemName: { type: 'string' }, size: { type: 'string' },
      priceSelection: { ...ref('QuotationPriceSelection'), nullable: true, readOnly: true },
      quantityInspection: money, quantityMaintenance: money, priceInspection: money, priceMaintenance: {...money,nullable:true}, subTotal: money, isActive: { type: 'boolean' }, ...audit,
    },
  },
  Quotation: {
    type: 'object', required: [...Object.keys(header).filter(key=>key!=='companyId'), 'date', 'no', 'numberYear', 'id', 'officeBranchId', 'customerSnapshot', 'companySnapshot', 'status', 'invoiceStatus', 'subTotal', 'taxAmount', 'total', 'version', 'revision', 'isActive', 'items', ...Object.keys(audit)],
    properties: {
      ...Object.fromEntries(Object.entries(header).filter(([key])=>key!=='companyId')),
      tax: { type: 'string', readOnly: true, example: '11.25', description: 'Snapshot percentage selected from synchronized branch tax on creation.' },
      taxSourceId: { ...uuid, nullable: true, readOnly: true },
      status: { allOf: [ref('QuotationStatus')], readOnly: true },
      previousQuotationId: { ...uuid, nullable: true, readOnly: true, description: 'Previous approved quotation replaced by this revision.' },
      pdfDocument: { allOf: [ref('QuotationPdf')], nullable: true, readOnly: true },
      pdf: { type: 'object', readOnly: true, description: 'Included by GET detail and approval when a PDF exists.', properties: { url: { type: 'string', format: 'uri' }, expiresAt: timestamp } },
      invoiceStatus: { allOf: [ref('InvoiceStatus')], nullable: true, readOnly: true },
      no: { type: 'integer', nullable: true, minimum: 1, maximum: 2147483647, readOnly: true, description: 'Null for drafts. Assigned only on approval; approved revisions reuse the previous number.' },
      numberYear: { type: 'integer', nullable: true, readOnly: true, description: 'Null for drafts. First approval year in Asia/Jakarta; revisions retain the original year.' },
      date: { ...timestamp, nullable: true, readOnly: true, description: 'Server-managed Asia/Jakarta calendar date serialized at UTC midnight. Set on creation and refreshed when the first number is assigned at approval; revisions retain the original numbered quotation date.' },
      inquiryDate: timestamp, id: uuid, officeBranchId: { ...uuid, readOnly: true },
      companySnapshot: { type: 'object', readOnly: true, description: 'Company id, version, name, type, address and npwp captured at creation or contact replacement. Profile edits do not alter this snapshot.' },
      customerSnapshot: { type: 'string', readOnly: true, example: 'Budi Santoso', description: 'Company staff name captured when the quotation is created or its contact is replaced.' },
      subTotal: { ...money, readOnly: true }, taxAmount: { ...money, readOnly: true }, total: { ...money, readOnly: true },
      version: { type: 'integer', minimum: 0 }, isActive: { type: 'boolean' }, ...audit,
      revision: { type: 'integer', minimum: 0, readOnly: true, example: 1, description: 'Initially 0. Revising approved content creates a new quotation ID with revision + 1 and previousQuotationId. Draft edits do not increment revision. Approval reuses the original no/numberYear. Use version for concurrency checks.' },
      items: { type: 'array', items: ref('QuotationItem') },
    },
  },
  QuotationResponse: envelope(ref('Quotation')),
  QuotationListResponse: envelope({
    type: 'object', required: ['quotations', 'pagination'],
    properties: { quotations: { type: 'array', items: ref('Quotation') }, pagination: ref('Pagination') },
  }),
};
const response = (description: string, name: string) => ({ description, content: { 'application/json': { schema: ref(name) } } });
const commonErrors = {
  400: response('Invalid body, query, or quotation ID', 'ErrorResponse'),
  401: response('Missing or invalid access token', 'ErrorResponse'),
  403: response('Marketing access and an office branch assignment are required', 'ErrorResponse'),
  429: response('Rate limit exceeded', 'ErrorResponse'),
  500: response('Internal server error', 'ErrorResponse'),
};
const common = { tags: ['Quotations'], security: [{ bearerAuth: [] }, { accessTokenCookie: [] }] };
const idParameter = { in: 'path', name: 'quotationId', required: true, schema: uuid };
export const quotationPaths = {
  '/api/v1/marketing/quotations/{quotationId}/approve': {
    post: {
      ...common, summary: 'Approve quotation, generate PDF and store in Neon', parameters: [idParameter],
      description: 'Requires the current version and active CREATED, SENT or REVISED status. Approval assigns no/numberYear and generates the numbered PDF inside a transaction holding the branch/year sequence lock. Uploads to akura/quotation/{branch}/{id}/r{revision}/{uuid}.pdf before committing status, the optional 1:1 PDF relation and APPROVE history. Failures roll back the number and counter. Approved revisions inherit the original no/year without consuming a number. Returns pdf.url valid for 15 minutes. Retrying the latest approved version returns the same PDF. A stale version returns 409. Historical PDFs remain attached to inactive quotations.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('ApproveQuotationRequest') } } },
      responses: { ...commonErrors, 200: response('Quotation approved with PDF download URL', 'ApproveQuotationResponse'),
        404: response('Active quotation not found in this branch', 'ErrorResponse'),
        409: response('Version conflict, unsupported status or no active items', 'ErrorResponse'),
        503: response('PDF storage unavailable; reload quotation before retrying', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations': {
    get: {
      ...common, summary: 'List all quotations in the current branch',
      description: 'Returns quotations exclusively within the authenticated user office branch. Only ADMIN may view inactive quotations; other roles always use isActive=true, overriding isActive=false. ADMIN may omit isActive for both states or filter either state. Pagination counts follow the enforced filter. Nested historical item rows retain their original state. Stored totals represent the document totals, not a sum of historical inactive lines. Ordered by createdAt descending, then ID descending.',
      parameters: [
        { in: 'query', name: 'isActive', description: 'ADMIN may select either state; all other roles always receive active quotations.', schema: { type: 'string', enum: ['true', 'false'] } },
        { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
        { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: { ...commonErrors, 200: response('Quotations retrieved', 'QuotationListResponse') },
    },
    post: {
      ...common, summary: 'Create a quotation with items',
      description: 'Creates the quotation, 1–100 items, totals, customer/catalog snapshots, and history atomically. Creates an unnumbered draft with no=null, numberYear=null and pdfDocument=null; it does not touch the sequence. Numbers are assigned only by approval. Select companyId and itemSizeId within the current branch; staffId is optional and must belong to that company. date is set to today in Asia/Jakarta; any supplied date is ignored on create and update. tax, status, invoiceStatus, no, numberYear, item IDs, audit fields, and totals cannot be supplied. Tax is selected from local branch configuration effective today in Asia/Jakarta at creation; missing configuration returns 503. The server initializes status to CREATED and invoiceStatus to null. Line subtotals are rounded to two decimals before summing; taxAmount = subTotal × tax / 100, total = subTotal + taxAmount.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('CreateQuotationRequest') } } },
      responses: { ...commonErrors, 201: response('Quotation created with items', 'QuotationResponse'), 404: response('Company staff or catalog size not found or inactive in this branch', 'ErrorResponse'), 409: response('Number limit reached or quotation numbering conflict', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}': {
    patch: {
      ...common, summary: 'Update quotation header and items', parameters: [idParameter],
      description: 'Requires version and at least one editable field. Omitted header fields and omitted items remain unchanged. When items is supplied, send the complete desired active list (1-100 lines): include id to retain/edit a line, omit id to add a line, and leave out old lines to soft-delete them. Changing an existing line catalog reference requires replacing the line. Header, items, totals, audit, version, revision and history are saved atomically. Draft updates increment version and keep revision unchanged. Editing approved content creates and RETURNS A NEW quotation ID with version=0, revision=old+1, previousQuotationId=old.id, status=REVISED, no=null, numberYear=null and pdfDocument=null. The old quotation becomes inactive; its content, item snapshots, number and 1:1 PDF remain intact. Identical approved content does not create a revision. Use the returned ID/version for subsequent requests. status/invoiceStatus/no/numberYear/revision/audit/totals cannot be supplied. Concurrent header/item updates with the same version result in one success and one 409. Responses and GET detail include historical item rows. Every item identifies its own isActive state.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('UpdateQuotationRequest') } } },
      responses: { ...commonErrors, 200: response('Quotation updated', 'QuotationResponse'), 404: response('Quotation, staff or item not found in this branch', 'ErrorResponse'), 409: response('Version is stale or quotation is inactive; reload before retrying', 'ErrorResponse') },
    },
    get: {
      ...common, summary: 'Get quotation and its historical PDF', parameters: [idParameter],
      description: 'Returns active or inactive quotation and item snapshots in the current branch, including its optional 1:1 pdfDocument and pdf.url signed for 15 minutes. Other-branch quotations return 404. Operational quotation-references remain active-only.',
      responses: { ...commonErrors, 200: response('Quotation retrieved', 'QuotationResponse'), 404: response('Active quotation not found in this branch', 'ErrorResponse') },
    },
    delete: {
      ...common, summary: 'Soft delete a quotation', parameters: [idParameter],
      description: 'Sets isActive=false on the quotation and active items, increments version, records the actor, and appends history atomically. Stored rows and historical snapshots are preserved. GET retains access to historical data and the associated PDF. Repeated deletion or a stale version returns 409.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('DeleteQuotationRequest') } } },
      responses: { ...commonErrors, 200: response('Quotation and items deactivated', 'QuotationResponse'), 404: response('Quotation not found in this branch', 'ErrorResponse'), 409: response('Quotation changed or is already inactive', 'ErrorResponse') },
    },
  },
};
