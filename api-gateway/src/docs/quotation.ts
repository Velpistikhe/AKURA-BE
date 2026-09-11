const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: 'string', format: 'uuid' };
const timestamp = { type: 'string', format: 'date-time' };
const text = { type: 'string', minLength: 1, maxLength: 255 };
const money = { type: 'string', format: 'decimal', example: '100.25' };
const header = {
  date: { type: 'string', format: 'date', nullable: true },
  inquiryMethod: ref('InquiryMethod'),
  inquiryDate: { type: 'string', format: 'date' },
  subject: text, termOfPayment: text, validity: text,
  tax: { type: 'integer', minimum: 0, maximum: 100, description: 'Tax percentage; totals are calculated by the server.' },
  supplyAkura: text, supplyCustomer: text, location: text, accomplished: text, deliveryReports: text,
  staffId: uuid,
  status: { allOf: [ref('QuotationStatus')], default: 'CREATED' },
  invoiceStatus: ref('InvoiceStatus'),
};
const audit = {
  createdById: { ...uuid, readOnly: true }, updatedById: { ...uuid, nullable: true, readOnly: true },
  createdAt: timestamp, updatedAt: timestamp,
};
const requiredHeader = ['inquiryMethod', 'inquiryDate', 'subject', 'termOfPayment', 'validity', 'tax', 'supplyAkura', 'supplyCustomer', 'location', 'accomplished', 'deliveryReports', 'staffId'];
const envelope = (data: object) => ({
  type: 'object', required: ['status', 'success', 'message', 'data'],
  properties: { status: { type: 'integer' }, success: { type: 'boolean', enum: [true] }, message: { type: 'string' }, data, requestId: uuid },
});
export const quotationSchemas = {
  InvoiceStatus: {
    type: 'string', nullable: true, enum: ['CREATED', 'SEND', 'APPROVED', 'COMPLETE', 'CANCELED', 'EXPIRED', null],
    description: 'Invoice status. Null when no invoice has been issued; defaults to null when omitted on creation. Values are case-sensitive.',
  },
  InquiryMethod: {
    type: 'string', enum: ['EMAIL', 'WHATSAPP', 'VERBAL', 'JOB_ORDER_REQUEST'],
    description: 'Inquiry channel. Values are case-sensitive.',
  },
  QuotationStatus: {
    type: 'string', enum: ['CREATED', 'SENT', 'REJECTED', 'APPROVED', 'REVISED', 'CONFIRMED', 'ON_PROGRESS', 'WORK_ORDER_COMPLETE', 'COMPLETE'],
    description: 'Quotation status. Defaults to CREATED when omitted on creation. Values are case-sensitive.',
  },
  QuotationItemInput: {
    type: 'object', additionalProperties: false, required: ['itemSizeId', 'quantity', 'unitPrice'],
    properties: {
      itemSizeId: { ...uuid, description: 'Active catalog size in the current office branch.' },
      quantity: { type: 'string', pattern: '^(?=.*[1-9])\\d{1,12}(\\.\\d{1,3})?$', example: '2.500', description: 'Positive decimal string; up to 12 integer digits and 3 decimal places.' },
      unitPrice: { ...money, pattern: '^\\d{1,12}(\\.\\d{1,2})?$', description: 'Nonnegative decimal string; up to 12 integer digits and 2 decimal places.' },
    },
  },
  CreateQuotationRequest: {
    type: 'object', additionalProperties: false, required: [...requiredHeader, 'items'],
    properties: { ...header, items: { type: 'array', minItems: 1, maxItems: 100, items: ref('QuotationItemInput') } },
    example: {
      inquiryMethod: 'EMAIL', status: 'CREATED', inquiryDate: '2026-09-10', subject: 'Inspection quotation', termOfPayment: '30 days', validity: '30 days', tax: 11,
      supplyAkura: 'Equipment', supplyCustomer: 'Site access', location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF',
      staffId: '11111111-1111-4111-8111-111111111111',
      items: [
        { itemSizeId: '33333333-3333-4333-8333-333333333333', quantity: '2.500', unitPrice: '100.25' },
        { itemSizeId: '44444444-4444-4444-8444-444444444444', quantity: '1', unitPrice: '50.00' },
      ],
    },
  },
  DeleteQuotationRequest: {
    type: 'object', additionalProperties: false, required: ['version'],
    properties: { version: { type: 'integer', minimum: 0, maximum: 2147483646, example: 0, description: 'Current quotation version returned by GET or POST. A stale version is rejected with 409.' } },
  },
  UpdateQuotationItemInput: {
    type: 'object', additionalProperties: false, required: ['itemSizeId', 'quantity', 'unitPrice'],
    properties: {
      id: { ...uuid, description: 'Existing active quotation item ID to retain or edit. Omit for a new line.' },
      itemSizeId: { ...uuid, description: 'Catalog reference; cannot change on an existing line.' },
      quantity: { type: 'string', pattern: '^(?=.*[1-9])\\d{1,12}(\\.\\d{1,3})?$', example: '2.500' },
      unitPrice: { ...money, pattern: '^\\d{1,12}(\\.\\d{1,2})?$' },
    },
  },
  UpdateQuotationRequest: {
    type: 'object', additionalProperties: false, required: ['version'], minProperties: 2,
    properties: {
      ...header, status: ref('QuotationStatus'),
      invoiceStatus: ref('InvoiceStatus'),
      version: { type: 'integer', minimum: 0, maximum: 2147483646, description: 'Latest version returned by GET/POST/PATCH; required for every update.' },
      items: { type: 'array', minItems: 1, maxItems: 100, items: ref('UpdateQuotationItemInput'), description: 'Complete desired active item list. Existing IDs must be unique. Omitted old lines are soft-deleted.' },
    },
    example: { version: 0, subject: 'Revised inspection quotation' },
  },
  QuotationItem: {
    type: 'object', required: ['id', 'quotationId', 'itemSizeId', 'position', 'serviceName', 'serviceType', 'itemName', 'size', 'quantity', 'unitPrice', 'subTotal', 'isActive', ...Object.keys(audit)],
    properties: {
      id: uuid, quotationId: uuid, itemSizeId: uuid, position: { type: 'integer', minimum: 0 },
      serviceName: { type: 'string' }, serviceType: ref('ServiceType'), itemName: { type: 'string' }, size: { type: 'string' },
      quantity: { type: 'string', format: 'decimal' }, unitPrice: money, subTotal: money, isActive: { type: 'boolean' }, ...audit,
    },
  },
  Quotation: {
    type: 'object', required: [...Object.keys(header), 'no', 'numberYear', 'id', 'officeBranchId', 'customerSnapshot', 'companySnapshot', 'subTotal', 'taxAmount', 'total', 'version', 'revision', 'isActive', 'items', ...Object.keys(audit)],
    properties: {
      ...header,
      no: { type: 'integer', minimum: 1, maximum: 2147483647, readOnly: true, description: 'Automatic sequential number per office branch and numberYear; starts at 1.' },
      numberYear: { type: 'integer', readOnly: true, description: 'Year at creation in Asia/Jakarta, independent of the document date. Assigned by the server.' },
      date: { ...timestamp, nullable: true, description: 'Stored date serialized as an ISO timestamp at UTC midnight.' },
      inquiryDate: timestamp, id: uuid, officeBranchId: { ...uuid, readOnly: true },
      companySnapshot: { type: 'object', readOnly: true, description: 'Company id, version, name, type, address and npwp captured at creation or contact replacement. Profile edits do not alter this snapshot.' },
      customerSnapshot: { type: 'string', readOnly: true, example: 'Budi Santoso', description: 'Company staff name captured when the quotation is created or its contact is replaced.' },
      subTotal: { ...money, readOnly: true }, taxAmount: { ...money, readOnly: true }, total: { ...money, readOnly: true },
      version: { type: 'integer', minimum: 0 }, isActive: { type: 'boolean' }, ...audit,
      revision: { type: 'integer', minimum: 0, readOnly: true, example: 1, description: 'Document revision count, initially 0. Increments once per update that changes header content or items. Status-only changes, identical content and soft deletion do not increment it. Display no 1 for no=1/revision=0, or no 1 revisi 2 for no=1/revision=2. Use version for concurrency checks.' },
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
  '/api/v1/marketing/quotations': {
    get: {
      ...common, summary: 'List active quotations',
      description: 'Returns active quotations and their active items in the authenticated user’s office branch. Ordered by createdAt descending, then ID descending.',
      parameters: [
        { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
        { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      ],
      responses: { ...commonErrors, 200: response('Quotations retrieved', 'QuotationListResponse') },
    },
    post: {
      ...common, summary: 'Create a quotation with items',
      description: 'Creates the quotation, 1–100 items, totals, customer/catalog snapshots, and history atomically. The server locks the branch/year counter, assigns lastNumber + 1 to no, and updates lastNumber in the same transaction. Each branch starts at 1 each year, using creation time in Asia/Jakarta. Failed transactions do not consume a number; soft deletion does not reuse numbers. Use existing staffId and itemSizeId values from the current branch. date may be omitted for drafts. no, numberYear, item IDs, audit fields, and totals cannot be supplied. Line subtotals are rounded to two decimals before summing; taxAmount = subTotal × tax / 100, total = subTotal + taxAmount.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('CreateQuotationRequest') } } },
      responses: { ...commonErrors, 201: response('Quotation created with items', 'QuotationResponse'), 404: response('Company staff or catalog size not found or inactive in this branch', 'ErrorResponse'), 409: response('Number limit reached or quotation numbering conflict', 'ErrorResponse') },
    },
  },
  '/api/v1/marketing/quotations/{quotationId}': {
    patch: {
      ...common, summary: 'Update quotation header and items', parameters: [idParameter],
      description: 'Requires version and at least one editable field. Omitted header fields and omitted items remain unchanged. When items is supplied, send the complete desired active list (1-100 lines): include id to retain/edit a line, omit id to add a line, and leave out old lines to soft-delete them. Changing an existing line catalog reference requires replacing the line. Header, items, totals, audit, version, revision and history are saved atomically. Every successful update increments version once. Content changes increment revision once; status-only or identical-content updates do not. no/numberYear/revision/audit/totals cannot be supplied. Concurrent header/item updates with the same version result in one success and one 409. Responses include all item rows, including inactive lines; GET returns active lines.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('UpdateQuotationRequest') } } },
      responses: { ...commonErrors, 200: response('Quotation updated', 'QuotationResponse'), 404: response('Quotation, staff or item not found in this branch', 'ErrorResponse'), 409: response('Version is stale or quotation is inactive; reload before retrying', 'ErrorResponse') },
    },
    get: {
      ...common, summary: 'Get an active quotation', parameters: [idParameter],
      description: 'Returns the quotation and active items from the current office branch. Deleted and other-branch quotations return 404.',
      responses: { ...commonErrors, 200: response('Quotation retrieved', 'QuotationResponse'), 404: response('Active quotation not found in this branch', 'ErrorResponse') },
    },
    delete: {
      ...common, summary: 'Soft delete a quotation', parameters: [idParameter],
      description: 'Sets isActive=false on the quotation and active items, increments version, records the actor, and appends history atomically. Stored rows and historical snapshots are preserved. GET no longer returns the quotation. Repeated deletion or a stale version returns 409.',
      requestBody: { required: true, content: { 'application/json': { schema: ref('DeleteQuotationRequest') } } },
      responses: { ...commonErrors, 200: response('Quotation and items deactivated', 'QuotationResponse'), 404: response('Quotation not found in this branch', 'ErrorResponse'), 409: response('Quotation changed or is already inactive', 'ErrorResponse') },
    },
  },
};
