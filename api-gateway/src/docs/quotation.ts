const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: 'string', format: 'uuid' };
const timestamp = { type: 'string', format: 'date-time' };
const text = { type: 'string', minLength: 1, maxLength: 255 };
const supplyText = { type: 'string', minLength: 1, maxLength: 5000, description: 'Supports newline characters.' };
const money = { type: 'string', format: 'decimal', example: '100.25' };
const header = {
  inquiryMethod: ref('InquiryMethod'),
  inquiryDate: { type: 'string', format: 'date' },
  jobStart: { type: 'string', minLength: 1, maxLength: 255, description: 'Planned job start value.' },
  subject: text, termOfPayment: text, validity: text,
  supplyAkura: supplyText, supplyCustomer: supplyText, location: text, accomplished: text, deliveryReports: text, deliveryInvoice: text,
  companyId: { ...uuid, description: 'Optional company filter. The staff must belong to this company when supplied.' },
  staffId: { ...uuid, nullable: false, description: 'Required contact belonging to the selected company and branch.' },
};
const audit = {
  createdById: { ...uuid, readOnly: true }, createdByName: { type: 'string', readOnly: true }, updatedById: { ...uuid, nullable: true, readOnly: true }, updatedByName: { type: 'string', nullable: true, readOnly: true },
  createdAt: timestamp, updatedAt: timestamp,
};
const requiredHeader = ['inquiryMethod', 'inquiryDate', 'jobStart', 'subject', 'termOfPayment', 'validity', 'supplyAkura', 'supplyCustomer', 'location', 'accomplished', 'deliveryReports', 'deliveryInvoice', 'staffId'];
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
  SubmitQuotationRequest: {
    type: 'object', additionalProperties: false, required: ['version'], properties: { version: { type: 'integer', minimum: 0, maximum: 2147483646 } },
  },
  RejectQuotationRequest: {
    type: 'object', additionalProperties: false, required: ['version'], properties: { version: { type: 'integer', minimum: 0, maximum: 2147483646 } },
  },
  QuotationHistory: {
    type: 'object', properties: { id: uuid, quotationId: uuid, version: { type: 'integer' }, action: { type: 'string' }, changes: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, label: { type: 'string' }, before: {}, after: {} }, required: ['field', 'label', 'before', 'after'] } }, createdById: uuid, createdByName: { type: 'string' }, createdBy: { type: 'object', properties: { id: uuid, name: { type: 'string' } }, required: ['id', 'name'] }, createdAt: timestamp },
  },
  QuotationSnapshot: {
    type: 'object', properties: { id: uuid, quotationId: uuid, version: { type: 'integer' }, action: { type: 'string' }, snapshot: { type: 'object', additionalProperties: true }, createdById: uuid, createdByName: { type: 'string' }, createdAt: timestamp },
  },
  QuotationHistoryResponse: envelope({ quotationId: uuid, history: { type: 'array', items: ref('QuotationHistory') }, pagination: ref('Pagination') }),
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
    type: 'string', enum: ['CREATED', 'SUBMITTED', 'REJECTED', 'APPROVED', 'REVISED', 'CONFIRMED', 'ON_PROGRESS', 'WORK_ORDER_COMPLETE', 'COMPLETE'],
    description: 'Quotation status. Managed by the server; initialized to CREATED on creation. Values are case-sensitive.',
  },
  QuotationItemInput: {
    type:'object',additionalProperties:false,required:['itemSizeId','quantityInspection'],
    description:'One row per size with two quantities. Items may belong to a service or be standalone; standalone item scopes are snapshotted into the quotation. Maintenance may be omitted or zero; at least one quantity must be positive. Server re-resolves current company prices in the transaction: an effective contract price from the company’s active APPROVED contract is used when available for the size; otherwise primary/sister pricing applies. Prices, source tokens and priceKind are rejected.',
    properties:{ itemSizeId:uuid,
      quantityInspection:{oneOf:[{type:'string',pattern:'^\\d{1,12}(\\.\\d{1,3})?$'},{type:'number',minimum:0,multipleOf:0.001,maximum:999999999999.999}],example:'2'},
      quantityMaintenance:{oneOf:[{type:'string',pattern:'^\\d{1,12}(\\.\\d{1,3})?$'},{type:'number',minimum:0,multipleOf:0.001,maximum:999999999999.999}],default:'0',example:'0'},
      note:{type:'string',maxLength:5000,nullable:true,description:'Optional note for this quotation item.'},
    },
  },
  CreateWorkOrderFromQuotationRequest: {
    type: 'object', additionalProperties: false, required: ['quotationId', 'startDate', 'endDate', 'inspectors'],
    properties: {
      quotationId: { type: 'string', format: 'uuid', description: 'Must match the quotationId in the path. The quotation must be APPROVED in the authenticated branch.' },
      startDate: { type: 'string', format: 'date' },
      endDate: { type: 'string', format: 'date', description: 'Required. Must be on or after startDate.' },
      inspectors: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['userId', 'name'], properties: { userId: { type: 'string', format: 'uuid', description: 'ID of an inspector option returned by GET /api/v1/fieldservice/options/inspectors for the authenticated branch (an active FIELD_SERVICE user synchronized into Field Service).' }, name: { type: 'string', minLength: 1, maxLength: 255, description: 'Display name (firstName + lastName) copied from the same inspector option snapshot. Field Service re-validates the pair before storing it; duplicate userId values are rejected.' } } }, description: 'Inspector user pairs in display order; duplicates are rejected.' },
    },
    example: { quotationId: '00000000-0000-4000-8000-000000000009', startDate: '2026-09-15', endDate: '2026-09-18', inspectors: [
      { userId: '00000000-0000-4000-8000-0000000000a1', name: 'Budi Santoso' },
      { userId: '00000000-0000-4000-8000-0000000000a2', name: 'Agus Wijaya' },
    ] },
  },
  CreateQuotationRequest: {
    type: 'object', additionalProperties: false, required: [...requiredHeader, 'items'],
    properties: { ...header, items: { type: 'array', minItems: 1, maxItems: 100, items: ref('QuotationItemInput') } },
  },

  UpdateQuotationRequest: {
    type: 'object', additionalProperties: false, required: ['version'], minProperties: 2,
    description: 'Updates a CREATED quotation only. companyId is immutable and rejected; staffId may change only to an active staff member in the same company and branch. Stale versions return 409.',
    properties: { version: { type: 'integer', minimum: 0, maximum: 2147483646 }, ...header, companyId: { ...uuid, readOnly: true, description: 'Immutable; do not submit.' } },
  },
  AddQuotationItemRequest: { type: 'object', additionalProperties: false, required: ['version', 'itemSizeId', 'quantityInspection'], properties: { version: { type: 'integer', minimum: 0 }, itemSizeId: uuid, quantityInspection: { oneOf: [{ type: 'string' }, { type: 'number', minimum: 0 }] }, quantityMaintenance: { oneOf: [{ type: 'string' }, { type: 'number', minimum: 0 }], default: '0' }, note: { type: 'string', nullable: true, maxLength: 5000 } } },
  DeleteQuotationItemRequest: { type: 'object', additionalProperties: false, required: ['quotationVersion', 'itemVersion'], properties: { quotationVersion: { type: 'integer', minimum: 0 }, itemVersion: { type: 'integer', minimum: 0 } } },

  QuotationItem: {
    type: 'object', required: ['id', 'quotationId', 'itemSizeId', 'position', 'serviceName', 'serviceType', 'itemName', 'size', 'quantityInspection', 'quantityMaintenance', 'priceInspection', 'priceMaintenance', 'note', 'subTotal', 'isActive', ...Object.keys(audit)],
    properties: {
      id: uuid, quotationId: uuid, itemSizeId: uuid, position: { type: 'integer', minimum: 0 },
      serviceName: { type: 'string' }, serviceType: ref('ServiceType'), itemName: { type: 'string' }, size: { type: 'string', nullable: true, description: 'Null for an item without a size.' },
      note: { type: 'string', maxLength: 5000, nullable: true, description: 'Optional note for this quotation item.' },
      priceSelection: { ...ref('QuotationPriceSelection'), nullable: true, readOnly: true },
      quantityInspection: money, quantityMaintenance: money, priceInspection: money, priceMaintenance: {...money,nullable:true}, subTotal: money, isActive: { type: 'boolean' }, version: { type: 'integer', minimum: 0 }, ...audit,
    },
  },
  Quotation: {
    type: 'object', required: [...Object.keys(header).filter(key=>key!=='companyId'), 'date', 'no', 'numberYear', 'id', 'officeBranchId', 'customerSnapshot', 'companySnapshot', 'status', 'invoiceStatus', 'subTotal', 'taxAmount', 'total', 'version', 'revision', 'isActive', 'items', ...Object.keys(audit)],
    properties: {
      ...Object.fromEntries(Object.entries(header).filter(([key])=>key!=='companyId')),
      tax: { type: 'string', readOnly: true, example: '11.25', description: 'Snapshot percentage selected from synchronized branch tax on creation.' },
      taxSourceId: { ...uuid, readOnly: true },
      status: { allOf: [ref('QuotationStatus')], readOnly: true },
      previousQuotationId: { ...uuid, nullable: true, readOnly: true, description: 'Previous approved quotation replaced by this revision.' },
      pdfDocument: { allOf: [ref('QuotationPdf')], nullable: true, readOnly: true },
      pdf: { type: 'object', readOnly: true, description: 'Included by GET detail and approval when a PDF exists.', properties: { url: { type: 'string', format: 'uri' }, expiresAt: timestamp } },
      invoiceStatus: { allOf: [ref('InvoiceStatus')], nullable: true, readOnly: true },
      no: { type: 'integer', nullable: true, minimum: 1, maximum: 2147483647, readOnly: true, description: 'Null for drafts. Assigned only on approval; approved revisions reuse the previous number.' },
      numberYear: { type: 'integer', nullable: true, readOnly: true, description: 'Null for drafts. First approval year in Asia/Jakarta; revisions retain the original year.' },
      date: { ...timestamp, nullable: true, readOnly: true, description: 'Server-managed Asia/Jakarta calendar date serialized at UTC midnight. Set on creation and refreshed when the first number is assigned at approval; revisions retain the original numbered quotation date.' },
      inquiryDate: timestamp, jobStart: { type: 'string', minLength: 1, maxLength: 255 }, id: uuid, officeBranchId: { ...uuid, readOnly: true },
      companySnapshot: { type: 'object', readOnly: true, description: 'Company id, version, name, type, address and npwp captured at creation or contact replacement. Profile edits do not alter this snapshot.' },
      customerSnapshot: { type: 'string', readOnly: true, example: 'Budi Santoso', description: 'Company staff name captured when the quotation is created or its contact is replaced.' },
      subTotal: { ...money, readOnly: true }, taxAmount: { ...money, readOnly: true }, total: { ...money, readOnly: true },
      version: { type: 'integer', minimum: 0 }, isActive: { type: 'boolean' }, ...audit,
      revision: { type: 'integer', minimum: 0, readOnly: true, example: 1, description: 'Initially 0. Revising approved content creates a new quotation ID with revision + 1 and previousQuotationId. Draft edits do not increment revision. Approval reuses the original no/numberYear. Use version for concurrency checks.' },
      hasWorkOrder: { type: 'boolean', readOnly: true, description: 'True while this quotation has a live Work Order. Cleared when Field Service revokes that Work Order.' },
      workOrderId: { ...uuid, nullable: true, readOnly: true, description: 'Field Service Work Order currently linked to this quotation; null when no live Work Order exists.' },
      workOrderSnapshot: { type: 'object', nullable: true, readOnly: true, description: 'Work Order response snapshot stored when the Work Order was created; cleared on revoke.' },
      items: { type: 'array', items: ref('QuotationItem') },
    },
  },
  QuotationListRow: {
    type: 'object',
    required: ['id', 'officeBranchId', 'date', 'no', 'numberYear', 'subject', 'customerSnapshot', 'companyId', 'companyName', 'status', 'invoiceStatus', 'subTotal', 'taxAmount', 'total', 'version', 'revision', 'isActive', 'createdAt', 'updatedAt'],
    properties: {
      id: uuid, officeBranchId: uuid, date: { ...timestamp, nullable: true }, no: { type: 'integer', nullable: true }, numberYear: { type: 'integer', nullable: true },
      subject: text, customerSnapshot: { type: 'string' }, companyId: { ...uuid, nullable: true }, companyName: { type: 'string', nullable: true },
      status: ref('QuotationStatus'), invoiceStatus: ref('InvoiceStatus'), subTotal: money, taxAmount: money, total: money,
      version: { type: 'integer' }, revision: { type: 'integer' }, isActive: { type: 'boolean' }, createdAt: timestamp, updatedAt: timestamp,
      hasWorkOrder: { type: 'boolean', readOnly: true, description: 'True while this quotation has a live Work Order.' },
      workOrderId: { ...uuid, nullable: true, readOnly: true, description: 'Field Service Work Order currently linked to this quotation.' },
    },
  },
  QuotationResponse: envelope(ref('Quotation')),
  QuotationListResponse: envelope({
    type: 'object', required: ['quotations', 'pagination'],
    properties: { quotations: { type: 'array', items: ref('QuotationListRow') }, pagination: ref('Pagination') },
  }),
  QuotationReferenceRow: {
    type: 'object',
    required: ['id', 'officeBranchId', 'date', 'no', 'numberYear', 'subject', 'customerSnapshot', 'companyId', 'companyName', 'status', 'invoiceStatus', 'subTotal', 'taxAmount', 'total', 'version', 'revision', 'isActive', 'createdAt', 'updatedAt', 'approvedAt'],
    properties: {
      id: uuid, officeBranchId: uuid, date: { ...timestamp, nullable: true }, no: { type: 'integer', nullable: true }, numberYear: { type: 'integer', nullable: true },
      subject: text, customerSnapshot: { type: 'string' }, companyId: { ...uuid, nullable: true }, companyName: { type: 'string', nullable: true },
      status: ref('QuotationStatus'), invoiceStatus: ref('InvoiceStatus'), subTotal: money, taxAmount: money, total: money,
      version: { type: 'integer' }, revision: { type: 'integer' }, isActive: { type: 'boolean' }, createdAt: timestamp, updatedAt: timestamp,
      hasWorkOrder: { type: 'boolean', readOnly: true, description: 'True while this quotation has a live Work Order.' },
      workOrderId: { ...uuid, nullable: true, readOnly: true, description: 'Field Service Work Order currently linked to this quotation.' },
      approvedAt: { ...timestamp, nullable: true, description: 'Approval time of the stored quotation PDF document.' },
    },
  },
  QuotationReferenceListResponse: envelope({
    type: 'object', required: ['quotations'],
    description: 'Branch-scoped APPROVED, active, non-contract-priced quotations, newest approval first, capped at 1000 rows.',
    properties: { quotations: { type: 'array', items: ref('QuotationReferenceRow') } },
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
  '/api/v1/marketing/quotation-references': {
    get: {
      ...common, summary: 'List quotation references for downstream document bases',
      description: 'Branch-scoped, read-only list of active APPROVED quotations that are not contract priced (those must use the contract basis). The branch comes from the access token only. Ordered by approval time descending and capped at 1000 rows. Allowed sections: MARKETING, FINANCE, ACCOUNTING and FIELD_SERVICE, plus ADMIN and APP_MANAGER roles. Field Service uses this list for the work-order quotation options and resolves the chosen quotation again through GET /api/v1/marketing/quotation-references/{quotationId} when the Work Order is created.',
      responses: { ...commonErrors, 200: response('Quotation reference list retrieved', 'QuotationReferenceListResponse'),
        403: response('Section access denied for quotation references', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}/pdf': {
    get: {
      ...common, summary: 'Preview quotation as PDF without storing it', parameters: [idParameter],
      description: 'Returns the existing quotation format as an inline PDF generated in memory. Draft quotations use a temporary PREVIEW number and do not update quotation, numbering sequence, history, or QuotationPdf. Approved or numbered quotations use their official number. The quotation must be active and belong to the authenticated office branch. Response is not cached or stored.',
      responses: { 200: { description: 'Quotation PDF preview', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } }, ...commonErrors, 404: response('Active quotation not found in this branch', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}/work-orders': {
    post: {
      ...common, summary: 'Create a DRAFT Work Order from an approved quotation', parameters: [idParameter],
      description: 'Creates the Work Order in Field Service using the selected active quotation in the authenticated branch. Requires an APPROVED quotation and standard/sister pricing (contract-priced quotations must use the contract basis). The payload must include quotationId (matching the path), startDate, endDate and the inspectors array of { userId, name } pairs copied verbatim from the Field Service inspector options snapshot; after all other validations pass Field Service re-validates every pair against its local FieldServiceUser read model (the name must equal the snapshot display name firstName+lastName) and stores the confirmed userId and name in the Work Order, rejecting mismatches or IDs outside the authenticated branch. The user access token is forwarded and independently verified by Field Service. While another non-revoked Work Order in the branch already references the same quotation, Field Service rejects the creation with 409 because one quotation may back only one live Work Order; revoking that Work Order frees the quotation for a new creation. Status is always DRAFT; number/date and audit data are generated by Field Service. Creation persists its CREATE history atomically. Field Service unavailability returns 503; the operation is not retried automatically.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('CreateWorkOrderFromQuotationRequest') } } },
      responses: { ...commonErrors, 201: response('DRAFT Work Order created', 'WorkOrderResponse'), 400: response('quotationId does not match the path quotation', 'ErrorResponse'), 404: response('Active quotation not found in this branch', 'ErrorResponse'), 409: response('Quotation is not approved, quotation uses contract pricing, or the quotation already backs a non-revoked Work Order in this branch', 'ErrorResponse'), 503: response('Field Service is unavailable', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}/approve': {
    post: {
      ...common, summary: 'Approve quotation, generate PDF and store in Neon', parameters: [idParameter],
      description: 'Requires the current version, an active SUBMITTED quotation, and an authenticated ADMIN user whose section is MARKETING. The quotation must belong to the authenticated user office branch. Approval assigns no/numberYear and generates the numbered PDF inside a transaction holding the branch/year sequence lock. Uploads to akura/quotation/{branch}/{id}/r{revision}/{uuid}.pdf before committing status, the optional 1:1 PDF relation and APPROVE history. Failures roll back the number and counter. Approved revisions inherit the original no/year without consuming a number. Returns pdf.url valid for 15 minutes. Retrying the latest approved version returns the same PDF. A stale version returns 409. Historical PDFs remain attached to inactive quotations.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('ApproveQuotationRequest') } } },
      responses: { ...commonErrors, 200: response('Quotation approved with PDF download URL', 'ApproveQuotationResponse'),
        403: response('Only ADMIN users in the MARKETING section may approve quotations', 'ErrorResponse'),
        404: response('Active quotation not found in this branch', 'ErrorResponse'),
        409: response('Version conflict, unsupported status or no active items', 'ErrorResponse'),
        503: response('PDF storage unavailable; reload quotation before retrying', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}/revise': {
    post: {
      ...common, summary: 'Create a new revision from an approved quotation', parameters: [idParameter],
      description: 'Requires the current version, an active APPROVED quotation, and an ADMIN user whose section is MARKETING. Before any change is made the server re-validates the quotation against Field Service: while a non-revoked Work Order still references the quotation in the branch, revision is rejected with 409 "A quotation with an active Work Order cannot be revised until the Work Order is revoked"; Field Service unavailability fails closed with 503 instead of allowing the revision. On success the source quotation becomes REVISED/inactive and a new quotation ID is created with revision + 1, previousQuotationId pointing at the source, and copied active items. The new quotation starts as CREATED with no Work Order link.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('ApproveQuotationRequest') } } }, responses: { ...commonErrors, 201: response('Quotation revision created', 'QuotationResponse'), 403: response('Only ADMIN users in MARKETING may revise', 'ErrorResponse'), 409: response('Quotation must be active APPROVED with current version, or the quotation still has a live Work Order', 'ErrorResponse'), 503: response('Field Service unavailable while validating the Work Order state', 'ErrorResponse') } },
  },
  '/api/v1/marketing/quotations/{quotationId}/submit': {
    post: { ...common, summary: 'Submit a created or rejected quotation', parameters: [idParameter], requestBody: { required: true, content: { 'application/json': { schema: ref('SubmitQuotationRequest') } } }, responses: { ...commonErrors, 200: response('Quotation submitted', 'QuotationResponse'), 409: response('Quotation is not CREATED or REJECTED, or version is stale', 'ErrorResponse') } },
  },
  '/api/v1/marketing/quotations/{quotationId}/reject': {
    post: { ...common, summary: 'Reject a submitted quotation', parameters: [idParameter], requestBody: { required: true, content: { 'application/json': { schema: ref('RejectQuotationRequest') } } }, responses: { ...commonErrors, 200: response('Quotation rejected', 'QuotationResponse'), 403: response('Only ADMIN users in MARKETING may reject', 'ErrorResponse'), 409: response('Quotation is not SUBMITTED or version is stale', 'ErrorResponse') } },
  },
  '/api/v1/marketing/quotations': {
    get: {
      ...common, summary: 'List all quotations in the current branch',
      description: 'Returns quotation list rows exclusively within the authenticated user office branch. List rows omit quotation items, PDF metadata, long document text and the full company snapshot; use GET detail for complete documents. Only ADMIN may view inactive quotations; other roles always use isActive=true, overriding isActive=false. Superseded inactive REVISED rows remain visible so the revision lineage is listed. Filters: date range is inclusive on the quotation date, no is exact, status and invoiceStatus are exact enum values, and company is a case-insensitive partial match on the captured company name. Pagination counts follow all enforced filters. Ordered by createdAt descending, then ID descending.',
      parameters: [
        { in: 'query', name: 'isActive', description: 'ADMIN may select either state; all other roles always receive active quotations.', schema: { type: 'string', enum: ['true', 'false'] } },
        { in: 'query', name: 'dateFrom', description: 'Inclusive quotation date lower bound.', schema: { type: 'string', format: 'date' } },
        { in: 'query', name: 'dateTo', description: 'Inclusive quotation date upper bound. Must be on or after dateFrom.', schema: { type: 'string', format: 'date' } },
        { in: 'query', name: 'no', description: 'Exact quotation number. Drafts with null number are excluded when supplied.', schema: { type: 'integer', minimum: 1, maximum: 2147483647 } },
        { in: 'query', name: 'status', schema: ref('QuotationStatus') },
        { in: 'query', name: 'company', description: 'Case-insensitive partial match on companySnapshot.name.', schema: { type: 'string', minLength: 1, maxLength: 255 } },
        { in: 'query', name: 'invoiceStatus', schema: ref('InvoiceStatus') },
        { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
        { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: { ...commonErrors, 200: response('Quotations retrieved', 'QuotationListResponse') },
    },
    post: {
      ...common, summary: 'Create a quotation with items',
      description: 'Creates the quotation, 1-100 items, totals, customer/catalog snapshots, and history atomically. Creates an unnumbered draft with no=null, numberYear=null and pdfDocument=null; it does not touch the sequence. Numbers are assigned only by approval. Select companyId and itemSizeId within the current branch; staffId is optional and must belong to that company. date is set to today in Asia/Jakarta; any supplied date is ignored on create and update. tax, status, invoiceStatus, no, numberYear, item IDs, audit fields, and totals cannot be supplied. Tax is selected from local branch configuration effective today in Asia/Jakarta at creation; missing configuration returns 503. Item prices are resolved server-side: an active APPROVED contract with an effective contract price for the size stores CONTRACT pricing (priceSelection.contractId/priceId); otherwise primary or sister-company pricing is stored. The server initializes status to CREATED and invoiceStatus to null. Line subtotals are rounded to two decimals before summing; taxAmount = subTotal * tax / 100, total = subTotal + taxAmount.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('CreateQuotationRequest') } } },
      responses: { ...commonErrors, 201: response('Quotation created with items', 'QuotationResponse'), 404: response('Company staff or catalog size not found or inactive in this branch', 'ErrorResponse'), 409: response('Number limit reached or quotation numbering conflict', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}/history': {
    get: {
      ...common, summary: 'Get quotation history', parameters: [idParameter,
        { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
        { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        { in: 'query', name: 'action', schema: { type: 'string', maxLength: 20 } },
        { in: 'query', name: 'sortBy', schema: { type: 'string', enum: ['version', 'createdAt', 'action'], default: 'version' } },
        { in: 'query', name: 'sortOrder', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
      ],
       description: 'Returns field-level quotation changes for the authenticated branch. Full quotation backups are stored separately and are not included in this paginated response. Supports action filtering, sorting and pagination. History is read-only.',
      responses: { ...commonErrors, 200: response('Quotation history retrieved', 'QuotationHistoryResponse'), 404: response('Quotation not found in this branch', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}': {
    patch: {
      ...common, summary: 'Update a draft quotation header', parameters: [idParameter],
      requestBody: { required: true, content: { 'application/json': { schema: ref('UpdateQuotationRequest') } } },
      responses: { ...commonErrors, 200: response('Quotation updated', 'QuotationResponse'), 404: response('Quotation not found in this branch', 'ErrorResponse'), 409: response('Stale version, inactive quotation, invalid staff, or non-draft quotation', 'ErrorResponse') },
    },
    get: {
      ...common, summary: 'Get quotation and its historical PDF', parameters: [idParameter],
      description: 'Returns active or inactive quotation and item snapshots in the current branch, including its optional 1:1 pdfDocument and pdf.url signed for 15 minutes. Other-branch quotations return 404. Operational quotation-references remain active-only.',
      responses: { ...commonErrors, 200: response('Quotation retrieved', 'QuotationResponse'), 404: response('Active quotation not found in this branch', 'ErrorResponse') },
    },
    delete: {
      ...common, summary: 'Soft delete a quotation', parameters: [idParameter],
      description: 'Sets isActive=false. If this is a revision, the original quotation is atomically restored to APPROVED and active. Requires the current version and branch ownership.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('DeleteQuotationRequest') } } },
      responses: { ...commonErrors, 200: response('Quotation and items deactivated', 'QuotationResponse'), 404: response('Quotation not found in this branch', 'ErrorResponse'), 409: response('Quotation changed or is already inactive', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}/items': {
    post: {
      ...common, summary: 'Add an item to a draft quotation', parameters: [idParameter],
      description: 'Appends an item to a CREATED or REJECTED (or SUBMITTED for ADMIN) quotation in the current branch. Requires the current quotation version. The price is re-resolved in the transaction with the branch lock: an active APPROVED contract of the quotation company with an effective contract price for the size stores CONTRACT pricing; otherwise primary or sister-company pricing is stored. Duplicate active sizes return 409.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('AddQuotationItemRequest') } } },
      responses: { ...commonErrors, 201: response('Quotation item added', 'QuotationResponse'), 404: response('Quotation or item size not found in this branch', 'ErrorResponse'), 409: response('Stale version, duplicate item, inactive quotation/size, unavailable price, or non-editable quotation', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}/items/{itemId}': {
    delete: {
      ...common, summary: 'Soft delete an item from a draft quotation', parameters: [idParameter, { in: 'path', name: 'itemId', required: true, schema: uuid }],
      requestBody: { required: true, content: { 'application/json': { schema: ref('DeleteQuotationItemRequest') } } },
      responses: { ...commonErrors, 200: response('Quotation item deleted', 'QuotationResponse'), 404: response('Quotation or item not found in this branch', 'ErrorResponse'), 409: response('Stale quotation/item version, inactive quotation/item, or non-draft quotation', 'ErrorResponse') },
    },
  },
};
