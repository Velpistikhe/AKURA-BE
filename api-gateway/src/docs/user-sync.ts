export const userSyncPaths: Record<string, object> = {
  '/api/v1/marketing/internal/users/events': { post: {
    tags: ['User Management'], summary: 'Internal: synchronize an Auth user into the Marketing quotation contact read model', security: [],
    parameters: [
      { name: 'x-service-name', in: 'header', required: true, schema: { type: 'string', enum: ['auth-service'] } },
      { name: 'x-service-secret', in: 'header', required: true, schema: { type: 'string' } },
      { name: 'x-user-sync-secret', in: 'header', required: true, schema: { type: 'string' } },
    ],
    description: 'Internal Auth delivery through the API Gateway. Marketing stores a row only when the snapshot is an active ADMIN in MARKETING with an assigned branch; otherwise the local row is deleted. Duplicate and older versions are acknowledged without changing the local read model.',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['eventId', 'officeBranchId', 'version', 'user'], properties: {
      eventId: { type: 'string', format: 'uuid' }, officeBranchId: { type: 'string', format: 'uuid', nullable: true }, version: { type: 'integer', minimum: 1 },
      user: { type: 'object', additionalProperties: false, required: ['id', 'username', 'firstName', 'lastName', 'role', 'section', 'officeBranchId', 'isActive', 'version', 'createdAt', 'updatedAt'], properties: {
        id: { type: 'string', format: 'uuid' }, username: { type: 'string' }, firstName: { type: 'string' }, lastName: { type: 'string' },
        email: { type: 'string', format: 'email', nullable: true }, telp: { type: 'string', nullable: true }, role: { $ref: '#/components/schemas/UserRole' },
        section: { $ref: '#/components/schemas/NullableUserSection' }, officeBranchId: { type: 'string', format: 'uuid', nullable: true }, isActive: { type: 'boolean' },
        version: { type: 'integer', minimum: 1 }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
      } },
    } } } } },
    responses: { 200: { description: 'Event acknowledged after commit' }, 400: { description: 'Invalid event; local data unchanged' }, 403: { description: 'Invalid service credential' } },
  } },
};
