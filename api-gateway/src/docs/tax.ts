export const taxPaths: Record<string, object> = {
  '/api/v1/finance/taxes': {
    post: {
      tags: ['Taxes'], summary: 'Create a branch tax percentage and close the previous period',
      security: [{ bearerAuth: [] }, { accessTokenCookie: [] }],
      description: 'Requires an active user with BOTH ADMIN role and FINANCE section. Branch and audit actor come from the current auth profile. effectiveFrom must be strictly later than the latest tax start date in that branch, including scheduled future records. Previous effectiveUntil becomes new effectiveFrom minus one calendar day, inclusive. New effectiveUntil is null. The update and insert are atomic and serialized per branch. Finance owns the master tax. An outbox event is committed with the tax; HTTP cache delivery and retries run asynchronously. Existing quotation tax snapshots are unchanged. Read delivery status via GET /api/v1/finance/taxes/deliveries.',
      requestBody: { required: true, content: { 'application/json': { schema: {
        type: 'object', additionalProperties: false, required: ['percentage', 'effectiveFrom'], properties: {
          percentage: { oneOf: [{ type: 'number', minimum: 0, maximum: 100, multipleOf: 0.01 }, { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,2})?$', description: 'Decimal percentage from 0 to 100.' }], example: 11 },
          effectiveFrom: { type: 'string', format: 'date', example: '2026-10-01' },
        },
      } } } },
      responses: {
        201: { description: 'Tax created', content: { 'application/json': { schema: {
          type: 'object', properties: { status: { type: 'integer', example: 201 }, success: { type: 'boolean' }, message: { type: 'string' }, requestId: { type: 'string' },
            data: { type: 'object', properties: {
              id: { type: 'string', format: 'uuid' }, officeBranchId: { type: 'string', format: 'uuid' }, percentage: { type: 'string', example: '11.25' },
              effectiveFrom: { type: 'string', format: 'date-time' }, effectiveUntil: { type: 'string', format: 'date-time', nullable: true },
              createdById: { type: 'string', format: 'uuid' }, createdByName: { type: 'string' },
              updatedById: { type: 'string', format: 'uuid', nullable: true }, updatedByName: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
            } },
          },
        } } } },
        400: { description: 'Invalid percentage, date or extra fields' },
        401: { description: 'Missing or invalid authentication' },
        403: { description: 'Requires active ADMIN in FINANCE with an assigned branch' },
        409: { description: 'Start date is equal to or earlier than the latest branch tax start date' },
        500: { description: 'Database operation failed; transaction rolled back' },
      },
    },
  },
};

const taxSecurity = [{ bearerAuth: [] }, { accessTokenCookie: [] }];
const pageParameters = ['page', 'limit'].map(name => ({ name, in: 'query', schema: { type: 'integer', minimum: 1, ...(name === 'limit' ? { maximum: 100, default: 20 } : { default: 1 }) } }));
Object.assign(taxPaths['/api/v1/finance/taxes'], { get: {
  tags: ['Taxes'], summary: 'List Finance master tax periods for the current branch', security: taxSecurity, parameters: pageParameters,
  responses: { 200: { description: 'Tax periods, latest first; data is an array' }, 400: { description: 'Invalid pagination' }, 401: { description: 'Unauthenticated' }, 403: { description: 'Finance access and branch assignment required' } },
} });
taxPaths['/api/v1/finance/taxes/deliveries'] = { get: {
  tags: ['Taxes'], summary: 'Read tax cache delivery status for the current branch', security: taxSecurity, parameters: pageParameters,
  description: 'Returns data array containing id, eventId, targetService, attempts, nextRetryAt, deliveredAt and lastError. deliveredAt=null means pending. Failed deliveries retry automatically with backoff capped at five minutes plus jitter; successful deliveries are not retried.',
  responses: { 200: { description: 'Delivery status, newest event first' }, 400: { description: 'Invalid pagination' }, 401: { description: 'Unauthenticated' }, 403: { description: 'Finance access and branch assignment required' } },
} };
taxPaths['/api/v1/finance/taxes/resync'] = { post: {
  tags: ['Taxes'], summary: 'Queue a fresh branch tax snapshot for all configured consumers', security: taxSecurity,
  description: 'ADMIN in FINANCE only. Use to initialize a new consumer or restore its cache. Creates a new snapshot version without changing master tax. No periodic polling.',
  requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } },
  responses: { 202: { description: 'Queued; data contains eventId and version' }, 400: { description: 'Body must be empty' }, 401: { description: 'Unauthenticated' }, 403: { description: 'ADMIN in FINANCE required' } },
} };
// Internal delivery uses the gateway with Finance service credentials.
taxPaths['/api/v1/marketing/internal/taxes/events'] = { post: {
  tags: ['Taxes'], summary: 'Internal: apply a versioned Finance tax snapshot to Marketing', security: [],
  parameters: [{ name: 'x-service-name', in: 'header', required: true, schema: { type: 'string', enum: ['finance-service'] } }, { name: 'x-service-secret', in: 'header', required: true, schema: { type: 'string' } }, { name: 'x-tax-sync-secret', in: 'header', required: true, schema: { type: 'string' } }],
  description: 'Finance service credentials and tax sync secret required. The gateway injects the Marketing gateway secret. Direct service access is rejected. Atomic branch cache replacement; duplicate and older versions are acknowledged without changing cache. Acknowledgment is sent only after commit.',
  requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['eventId','officeBranchId','version','taxes'], properties: {
    eventId: { type: 'string', format: 'uuid' }, officeBranchId: { type: 'string', format: 'uuid' }, version: { type: 'integer', minimum: 1 },
    taxes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id','officeBranchId','percentage','effectiveFrom','effectiveUntil','updatedAt'], properties: {
      id: { type: 'string', format: 'uuid' }, officeBranchId: { type: 'string', format: 'uuid' }, percentage: { type: 'string', example: '11' },
      effectiveFrom: { type: 'string', format: 'date-time' }, effectiveUntil: { type: 'string', format: 'date-time', nullable: true }, updatedAt: { type: 'string', format: 'date-time' },
    } } },
  } } } } }, responses: { 200: { description: 'Acknowledged: {success:true,eventId}' }, 400: { description: 'Invalid event; cache unchanged' }, 403: { description: 'Invalid service credential' } },
} };
