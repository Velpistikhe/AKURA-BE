import { workOrderSchemas, workOrderPaths } from './work-orders.js';
import { operationalPaths, operationalSchemas } from './operational-documents.js';
import { catalogPaths, catalogSchemas } from './catalog.js';
import { quotationPaths, quotationSchemas } from './quotation.js';
import { taxPaths } from './tax.js';
import { userSyncPaths } from './user-sync.js';

import { groupByModule } from './module-tags.js';

const schemaRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const jsonContent = (schema: object) => ({
  content: {
    'application/json': { schema },
  },
});

const response = (description: string, schema?: object) => ({
  description,
  ...(schema ? jsonContent(schema) : {}),
});

const errorResponse = (description: string) => response(description, schemaRef('ErrorResponse'));

const protectedSecurity = [
  { bearerAuth: [] },
  { accessTokenCookie: [] },
];

const tokenCookieHeaders = {
  'Set-Cookie': {
    description: 'Sets HTTP-only accessToken and refreshToken cookies.',
    schema: { type: 'string' },
  },
};

const clearedTokenCookieHeaders = {
  'Set-Cookie': {
    description: 'Clears the HTTP-only accessToken and refreshToken cookies.',
    schema: { type: 'string' },
  },
};

const userResponse = (description: string) => response(description, schemaRef('UserResponse'));

const listSortParameters = (
  fields: string[],
  defaultSort = 'createdAt descending; createdAt cannot be requested explicitly.',
) => [
  {
    in: 'query', name: 'sortBy',
    description: `Allowlisted field used for sorting. When omitted, results are sorted by ${defaultSort}`,
    schema: { type: 'string', enum: fields },
  },
  {
    in: 'query', name: 'sortOrder',
    description: 'Sort direction.',
    schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
  },
];

const refreshTokenParameters = [
  {
    in: 'cookie', name: 'refreshToken', required: false,
    description: 'HTTP-only refresh token cookie set by login or token rotation.',
    schema: { type: 'string' },
  },
  {
    in: 'header', name: 'x-refresh-token', required: false,
    description: 'Alternative refresh-token transport. The refreshToken cookie takes precedence when both are supplied.',
    schema: { type: 'string' },
  },
];

export const openApiDocument = groupByModule({
  openapi: '3.0.3',
  info: {
    title: 'Akura API Gateway',
    version: '2.7.0',
    description: 'HTTP API for the Akura gateway, authentication, application management, and marketing services. Every documented downstream endpoint is accessed through this Gateway in production; opted-in local Marketing, Finance and Field Service microfrontends may call their own service directly during development with a valid Bearer token. Any request carrying the target-specific internal gateway secret must still present the correct secret. Frontends must send login, refresh and all API requests to the same gateway host unless using the documented local direct-service development mode. Internal service requests also use the gateway.',
  },
  servers: [
    {
      url: '/',
      description: 'Current API Gateway host',
    },
  ],
  tags: [],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'An RS256 JWT access token validated through the Auth Service JWKS. Its payload follows the AccessTokenClaims schema and includes the user name.',
      },
      accessTokenCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'accessToken',
        description: 'HTTP-only access token cookie set by login or refresh-token.',
      },
    },
    schemas: {
      ...quotationSchemas,
      ...operationalSchemas,
      ...workOrderSchemas,
      ...catalogSchemas,
      UserSection: {
        type: 'string',
        enum: ['ACCOUNTING', 'FINANCE', 'HRD_MANAGEMENT', 'MARKETING', 'FIELD_SERVICE'],
        description: 'The department or division assigned to a user.',
      },
      NullableUserSection: {
        type: 'string',
        nullable: true,
        enum: ['ACCOUNTING', 'FINANCE', 'HRD_MANAGEMENT', 'MARKETING', 'FIELD_SERVICE'],
        description: 'The department or division of the user. Null when not assigned.',
      },
      NullableMenuAccessSection: {
        type: 'string',
        nullable: true,
        enum: ['ACCOUNTING', 'FINANCE', 'HRD_MANAGEMENT', 'MARKETING', 'FIELD_SERVICE'],
        description: 'Section granted access to a menu item. Null grants access to every section.',
      },
      UserRole: {
        type: 'string',
        enum: ['USER', 'ADMIN', 'APP_MANAGER'],
        example: 'USER',
      },
      MenuAccessRole: {
        type: 'string',
        enum: ['USER', 'ADMIN', 'APP_MANAGER'],
        example: 'APP_MANAGER',
        description: 'Role granted access to a menu.',
      },
      NullableMenuAccessRole: {
        type: 'string',
        enum: ['USER', 'ADMIN', 'APP_MANAGER'],
        nullable: true,
        description: 'A null role grants the menu to every authenticated role.',
      },
      AccessTokenClaims: {
        type: 'object',
        description: 'Claims embedded in the RS256 access token stored in the accessToken cookie or sent as a Bearer token.',
        required: ['sub', 'name', 'username', 'role', 'officeBranchId', 'type', 'iss', 'aud', 'iat', 'exp'],
        properties: {
          sub: { type: 'string', format: 'uuid', description: 'User ID.' },
          name: { type: 'string', example: 'John Doe', description: 'Full name composed from firstName and lastName.' },
          username: { type: 'string', example: 'johndoe' },
          role: schemaRef('UserRole'),
          officeBranchId: { type: 'string', format: 'uuid', nullable: true, description: 'Office branch assigned to the authenticated user.' },
          type: { type: 'string', enum: ['access'] },
          iss: { type: 'string', example: 'akura-auth' },
          aud: { type: 'string', example: 'akura-api' },
          iat: { type: 'integer', format: 'int64', description: 'Issued-at time as a Unix timestamp.' },
          exp: { type: 'integer', format: 'int64', description: 'Expiration time as a Unix timestamp.' },
        },
      },
      MenuItem: {
        type: 'object',
        description: 'An active navigation item visible to the authenticated user after role and section filtering.',
        required: ['key', 'label', 'order'],
        properties: {
          key: { type: 'string', example: 'users_list', description: 'Unique slug identifier.' },
          label: { type: 'string', example: 'Daftar Pengguna' },
          order: { type: 'integer', example: 1 },
        },
      },
      Menu: {
        type: 'object',
        description: 'An active navigation menu group containing items accessible to the authenticated user.',
        required: ['key', 'label', 'hasItem', 'order', 'items'],
        properties: {
          key: { type: 'string', example: 'app_manager', description: 'Unique slug identifier.' },
          label: { type: 'string', example: 'App Manager' },
          hasItem: { type: 'boolean', example: true },
          order: { type: 'integer', example: 1 },
          items: { type: 'array', items: schemaRef('MenuItem'), description: 'Sub-menu items within this group.' },
        },
      },
      MyMenusResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'array',
            items: schemaRef('Menu'),
            description: 'Navigation menus accessible to the authenticated user based on role and section.',
          },
          requestId: { type: 'string', format: 'uuid' },
        },
        example: {
          status: 200,
          success: true,
          message: 'Menus retrieved successfully',
          data: [
            {
              key: 'app_manager',
              label: 'App Manager',
              hasItem: true,
              order: 1,
              items: [
                {
                  key: 'users_list',
                  label: 'Daftar Pengguna',
                  order: 1,
                },
              ],
            },
          ],
          requestId: '9539c2ec-d85b-4fa1-94a1-ca7627f1fe6a',
        },
      },
      OfficeBranch: {
        type: 'object',
        description: 'An office branch. At most one record can have isHead=true.',
        required: ['id', 'name', 'address', 'telp', 'email', 'isHead', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Kantor Pusat' },
          address: { type: 'string', example: 'Jl. Merdeka No. 10, Jakarta' },
          telp: { type: 'string', pattern: '^[0-9+().\\-\\s]+$', example: '+62 21 555 0100' },
          email: { type: 'string', format: 'email', example: 'jakarta@example.com' },
          isHead: { type: 'boolean', example: true, description: 'True only for the single head office branch.' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CreateOfficeBranchRequest: {
        type: 'object', additionalProperties: false,
        required: ['name', 'address', 'telp', 'email'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          address: { type: 'string', minLength: 1, maxLength: 500 },
          telp: { type: 'string', minLength: 3, maxLength: 30, pattern: '^[0-9+().\\-\\s]+$' },
          email: { type: 'string', format: 'email', maxLength: 254 },
          isHead: { type: 'boolean', default: false, description: 'Only one office branch may be marked as head.' },
        },
      },
      UpdateOfficeBranchRequest: {
        type: 'object', additionalProperties: false, minProperties: 1,
        description: 'Name cannot be changed after the office branch is created.',
        properties: {
          address: { type: 'string', minLength: 1, maxLength: 500 },
          telp: { type: 'string', minLength: 3, maxLength: 30, pattern: '^[0-9+().\\-\\s]+$' },
          email: { type: 'string', format: 'email', maxLength: 254 },
          isHead: { type: 'boolean', description: 'Setting true fails with 409 when another head office branch exists.' },
        },
      },
      OfficeBranchResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer' },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: schemaRef('OfficeBranch'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      OfficeBranchListResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object', required: ['officeBranches', 'pagination'],
            properties: {
              officeBranches: { type: 'array', items: schemaRef('OfficeBranch') },
              pagination: { type: 'object', required: ['page', 'limit', 'total', 'totalPages'], properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      OfficeBranchOption: {
        type: 'object', required: ['id', 'name'], additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Kantor Pusat' },
        },
      },
      OfficeBranchOptionsResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: { type: 'array', items: schemaRef('OfficeBranchOption') },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      UserProfile: {
        type: 'object',
        required: [
          'id', 'username', 'firstName', 'lastName', 'email', 'telp', 'role', 'section', 'officeBranchId', 'branch', 'isActive',
          'version', 'createdAt', 'updatedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          username: { type: 'string', example: 'johndoe' },
          firstName: { type: 'string', example: 'John' },
          lastName: { type: 'string', example: 'Doe' },
          email: { type: 'string', format: 'email', nullable: true, example: 'user@example.com' },
          telp: { type: 'string', nullable: true, example: '+62 811 1234 5678' },
          role: schemaRef('UserRole'),
          section: schemaRef('NullableUserSection'),
          officeBranchId: { type: 'string', format: 'uuid', nullable: true, description: 'Office branch ID stored by Auth Service without a cross-database foreign key.' },
          branch: { type: 'string', maxLength: 200, nullable: true, example: 'Kantor Pusat', description: 'Display name of the assigned office branch, captured together with officeBranchId.' },
          isActive: { type: 'boolean', example: true },
          version: { type: 'integer', minimum: 1, example: 1 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['status', 'success', 'message'],
        properties: {
          status: { type: 'integer', example: 400 },
          success: { type: 'boolean', enum: [false] },
          message: { type: 'string', example: 'Validation failed' },
          errors: { type: 'array', items: { type: 'object', additionalProperties: true } },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      UserResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: schemaRef('UserProfile'),
          accessToken: {
            type: 'string',
            description: 'Present only on GET /api/v1/auth/me: the already verified access token, echoed so development microfrontends can restore a Bearer token after a reload.',
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      AuthUserResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object',
            required: ['user', 'accessToken'],
            properties: {
              user: schemaRef('UserProfile'),
              accessToken: {
                type: 'string',
                description: 'Signed access token, also set as the httpOnly accessToken cookie. Returned so development microfrontends can send Authorization: Bearer to a directly accessed microservice. The refresh token is never returned in the body.',
              },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      TokenRefreshResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object',
            required: ['accessToken'],
            properties: {
              accessToken: {
                type: 'string',
                description: 'Rotated access token, also set as the httpOnly accessToken cookie. The rotated refresh token stays only in the httpOnly cookie.',
              },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      MessageResponse: {
        type: 'object',
        required: ['status', 'success', 'message'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      GatewayHealthResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', enum: [200] },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string', example: 'API Gateway is healthy' },
          data: {
            type: 'object', required: ['service', 'timestamp', 'uptime'],
            properties: {
              service: { type: 'string', enum: ['api-gateway'] },
              timestamp: { type: 'string', format: 'date-time' },
              uptime: { type: 'number', minimum: 0 },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      DownstreamHealthResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', enum: [200] },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string', example: 'Auth Service is healthy' },
          data: {
            type: 'object', required: ['service', 'timestamp', 'uptime'],
            properties: {
              service: { type: 'string', enum: ['auth-service', 'app-manager-service', 'marketing-service', 'fieldservice-service'] },
              timestamp: { type: 'string', format: 'date-time' },
              uptime: { type: 'number', minimum: 0 },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      ServiceRegistryResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', enum: [200] },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string', example: 'Services list retrieved successfully' },
          data: {
            type: 'array',
            items: {
              type: 'object', required: ['prefix', 'target', 'authRequired', 'description'],
              properties: {
                prefix: { type: 'string', example: '/api/v1/auth' },
                target: { type: 'string', description: 'Configured downstream service target.' },
                authRequired: { type: 'boolean' },
                description: { type: 'string' },
              },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      RegisterResponse: {
        type: 'object',
        description: 'Registration confirmation. Registration does not create a token session or set authentication cookies.',
        required: ['status', 'success', 'message'],
        properties: {
          status: { type: 'integer', enum: [201], example: 201 },
          success: { type: 'boolean', enum: [true], example: true },
          message: { type: 'string', example: 'User registered successfully' },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      RegisterRequest: {
        type: 'object',
        required: ['username', 'password', 'passwordConfirmation', 'firstName', 'lastName'],
        properties: {
          username: {
            type: 'string',
            minLength: 3,
            pattern: '^[a-zA-Z0-9_]+$',
            example: 'johndoe',
          },
          password: { type: 'string', format: 'password', minLength: 6, example: 'securePassword123' },
          passwordConfirmation: {
            type: 'string',
            format: 'password',
            minLength: 1,
            example: 'securePassword123',
          },
          firstName: { type: 'string', minLength: 1, example: 'John' },
          lastName: { type: 'string', minLength: 1, example: 'Doe' },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 255, example: 'john@example.com', description: 'Optional; normalized to lowercase. Send null to clear.' },
          telp: { type: 'string', nullable: true, minLength: 1, maxLength: 50, example: '+62 811 1234 5678', description: 'Optional. Send null to clear.' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, example: 'johndoe' },
          password: { type: 'string', format: 'password', minLength: 1, example: 'securePassword123' },
        },
      },
      UpdateProfileRequest: {
        type: 'object',
        required: ['firstName', 'lastName'],
        properties: {
          firstName: { type: 'string', minLength: 1, example: 'John' },
          lastName: { type: 'string', minLength: 1, example: 'Doe' },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 255, description: 'Optional; normalized to lowercase. Send null to clear. Omit to keep the current value.' },
          telp: { type: 'string', nullable: true, minLength: 1, maxLength: 50, description: 'Optional. Send null to clear. Omit to keep the current value.' },
        },
      },
      ChangePasswordRequest: {
        type: 'object',
        required: ['oldPassword', 'newPassword', 'newPasswordConfirmation'],
        properties: {
          oldPassword: { type: 'string', format: 'password', minLength: 1 },
          newPassword: { type: 'string', format: 'password', minLength: 6 },
          newPasswordConfirmation: { type: 'string', format: 'password', minLength: 1 },
        },
      },
      UpdateUserRequest: {
        type: 'object', additionalProperties: false, minProperties: 2,
        required: ['version'],
        properties: {
          role: schemaRef('UserRole'),
          section: schemaRef('NullableUserSection'),
          officeBranchId: { type: 'string', format: 'uuid', nullable: true, description: 'Sets or clears the user office branch assignment. Must be sent together with branch so the stored branch id and name stay consistent.' },
          branch: { type: 'string', maxLength: 200, nullable: true, description: 'Display name paired with officeBranchId. Required whenever officeBranchId is sent; use null only when clearing the assignment.' },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 255, description: 'Sets or clears the user email. Normalized to lowercase.' },
          telp: { type: 'string', nullable: true, minLength: 1, maxLength: 50, description: 'Sets or clears the user telephone.' },
          isActive: { type: 'boolean' },
          version: { type: 'integer', minimum: 1 },
        },
      },
      UserListResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object',
            required: ['users', 'pagination'],
            properties: {
              users: { type: 'array', items: schemaRef('UserProfile') },
              pagination: {
                type: 'object',
                required: ['page', 'limit', 'total', 'totalPages'],
                properties: {
                  page: { type: 'integer' },
                  limit: { type: 'integer' },
                  total: { type: 'integer' },
                  totalPages: { type: 'integer' },
                },
              },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      FieldServiceInspectorListResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] }, message: { type: 'string' },
          data: { type: 'object', required: ['inspectors'], properties: {
            inspectors: { type: 'array', items: { type: 'object', required: ['id', 'name'], properties: {
              id: { type: 'string', format: 'uuid' }, name: { type: 'string', description: 'Canonical display name (firstName + lastName).' },
            } } },
          } },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      UserSyncDeliveryListResponse: {
        type: 'object',
        description: 'Monitoring view of the Auth user-sync outbox (user_sync_deliveries).',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object',
            required: ['deliveries', 'pagination'],
            properties: {
              deliveries: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'eventId', 'targetService', 'attempts', 'nextRetryAt', 'deliveredAt', 'lastError', 'status', 'event'],
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    eventId: { type: 'string', format: 'uuid' },
                    targetService: { type: 'string', enum: ['marketing-service', 'fieldservice-service'] },
                    attempts: { type: 'integer', minimum: 0 },
                    nextRetryAt: { type: 'string', format: 'date-time', description: 'Next automatic retry time; only meaningful while status is pending.' },
                    deliveredAt: { type: 'string', format: 'date-time', nullable: true, description: 'null means the delivery is still pending.' },
                    lastError: { type: 'string', nullable: true, description: 'Most recent failure reason; cleared after a successful delivery.' },
                    status: { type: 'string', enum: ['pending', 'delivered'] },
                    event: {
                      type: 'object',
                      required: ['id', 'userId', 'version', 'createdAt'],
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        userId: { type: 'string', format: 'uuid' },
                        version: { type: 'integer', minimum: 1 },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
              pagination: {
                type: 'object',
                required: ['page', 'limit', 'total', 'totalPages'],
                properties: {
                  page: { type: 'integer' },
                  limit: { type: 'integer' },
                  total: { type: 'integer' },
                  totalPages: { type: 'integer' },
                },
              },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      ManagedMenu: {
        type: 'object',
        description: 'A menu record managed by an app manager.',
        required: ['isDeleted', 'id', 'key', 'label', 'hasItem', 'order', 'isActive', 'createdAt', 'updatedAt'],
        properties: {
          isDeleted: { type: 'boolean', readOnly: true, description: 'Soft deletion marker; deleted records are excluded from active reads.' },
          id: { type: 'string', format: 'uuid' },
          key: { type: 'string', example: 'app_manager' },
          label: { type: 'string', example: 'App Manager' },
          hasItem: { type: 'boolean', example: true },
          order: { type: 'integer', example: 1 },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ManagedMenuAccess: {
        type: 'object',
        required: ['isDeleted', 'id', 'menuItemId', 'role', 'section', 'createdAt', 'updatedAt', 'menuItem'],
        properties: {
          isDeleted: { type: 'boolean', readOnly: true, description: 'Soft deletion marker; deleted records are excluded from active reads.' },
          id: { type: 'string', format: 'uuid' },
          menuItemId: { type: 'string', format: 'uuid' },
          role: schemaRef('NullableMenuAccessRole'),
          section: schemaRef('NullableMenuAccessSection'),
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          menuItem: {
            type: 'object', required: ['id', 'key', 'label', 'menuId'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              key: { type: 'string' },
              label: { type: 'string' },
              menuId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
      MenuAccessResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer' },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: schemaRef('ManagedMenuAccess'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      MenuAccessListResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object', required: ['menuAccesses', 'pagination'],
            properties: {
              menuAccesses: { type: 'array', items: schemaRef('ManagedMenuAccess') },
              pagination: { type: 'object', required: ['page','limit','total','totalPages'], properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      CreateMenuAccessRequest: {
        type: 'object', required: ['menuItemId'], additionalProperties: false,
        properties: {
          menuItemId: { type: 'string', format: 'uuid' },
          role: schemaRef('NullableMenuAccessRole'),
          section: schemaRef('NullableMenuAccessSection'),
        },
      },
      UpdateMenuAccessRequest: {
        type: 'object', minProperties: 1, additionalProperties: false,
        properties: {
          menuItemId: { type: 'string', format: 'uuid' },
          role: schemaRef('NullableMenuAccessRole'),
          section: schemaRef('NullableMenuAccessSection'),
        },
      },
      MenuResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: schemaRef('ManagedMenu'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      MenuListResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object',
            required: ['menus', 'pagination'],
            properties: {
              menus: { type: 'array', items: schemaRef('ManagedMenu') },
              pagination: { type: 'object', required: ['page','limit','total','totalPages'], properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      CreateMenuRequest: {
        oneOf: [
          {
            type: 'object', additionalProperties: false, required: ['key', 'label', 'hasItem', 'items'],
            properties: {
              key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$', example: 'app_manager' },
              label: { type: 'string', minLength: 1, maxLength: 200, example: 'App Manager' },
              hasItem: { type: 'boolean', enum: [true] },
              order: { type: 'integer', minimum: 0, default: 0 },
              items: {
                type: 'array', minItems: 1, maxItems: 100,
                description: 'Item keys must be unique within this request and globally across menu items.',
                items: {
                  type: 'object', additionalProperties: false, required: ['key', 'label'],
                  properties: {
                    key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$' },
                    label: { type: 'string', minLength: 1, maxLength: 200 },
                    order: { type: 'integer', minimum: 0, default: 0 },
                  },
                },
              },
            },
          },
          {
            type: 'object', additionalProperties: false, required: ['key', 'label', 'hasItem'],
            properties: {
              key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$', example: 'dashboard' },
              label: { type: 'string', minLength: 1, maxLength: 200, example: 'Dashboard' },
              hasItem: { type: 'boolean', enum: [false] },
              order: { type: 'integer', minimum: 0, default: 0 },
            },
          },
        ],
      },
      UpdateMenuRequest: {
        type: 'object',
        description: 'Setting hasItem=false is rejected while any menu item still belongs to the menu. Setting it to true enables subsequent item creation but does not create items.',
        additionalProperties: false,
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$', example: 'app_manager' },
          label: { type: 'string', minLength: 1, maxLength: 200, example: 'App Manager' },
          hasItem: { type: 'boolean' },
          order: { type: 'integer', minimum: 0 },
          isActive: { type: 'boolean' },
        },
      },
      ManagedMenuItem: {
        type: 'object',
        description: 'A menu item record managed by an app manager.',
        required: ['isDeleted', 'id', 'menuId', 'key', 'label', 'order', 'isActive', 'createdAt', 'updatedAt'],
        properties: {
          isDeleted: { type: 'boolean', readOnly: true, description: 'Soft deletion marker; deleted records are excluded from active reads.' },
          id: { type: 'string', format: 'uuid' },
          menuId: { type: 'string', format: 'uuid' },
          key: { type: 'string', example: 'users_list' },
          label: { type: 'string', example: 'Daftar Pengguna' },
          order: { type: 'integer', example: 1 },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MenuItemResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: schemaRef('ManagedMenuItem'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      MenuItemListResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object',
            required: ['items', 'pagination'],
            properties: {
              items: { type: 'array', items: schemaRef('ManagedMenuItem') },
              pagination: { type: 'object', required: ['page','limit','total','totalPages'], properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      CreateMenuItemRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['menuId', 'key', 'label'],
        properties: {
          menuId: { type: 'string', format: 'uuid', description: 'ID of the parent menu.' },
          key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$', example: 'users_list', description: 'Unique slug key.' },
          label: { type: 'string', minLength: 1, maxLength: 200, example: 'Daftar Pengguna' },
          order: { type: 'integer', minimum: 0, default: 0 },
        },
      },
      UpdateMenuItemRequest: {
        type: 'object',
        additionalProperties: false,
        properties: {
          menuId: { type: 'string', format: 'uuid' },
          key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$', example: 'users_list' },
          label: { type: 'string', minLength: 1, maxLength: 200, example: 'Daftar Pengguna' },
          order: { type: 'integer', minimum: 0 },
          isActive: { type: 'boolean' },
        },
      },
      Company: {
        type: 'object',
        required: ['id', 'officeBranchId', 'name', 'normalizeName', 'type', 'address', 'npwp', 'isSisterCompany', 'contract', 'revoked', 'version', 'createdById', 'updatedById', 'createdAt', 'updatedAt', '_count'],
        properties: {
          npwp: { type: 'string', example: '0012345678901234' },
          id: { type: 'string', format: 'uuid' },
          officeBranchId: { type: 'string', format: 'uuid', readOnly: true, description: 'Owning branch, derived from the authenticated user.' },
          name: { type: 'string', example: 'PT Akura Indonesia' },
          normalizeName: { type: 'string', readOnly: true, example: 'ptakuraindonesia' },
          type: schemaRef('CompanyType'),
          address: { type: 'string', example: 'Jakarta' },
          isSisterCompany: { type: 'boolean', example: true, description: 'Selects sister-company standard prices when no current contract applies.' },
          contract: {
            ...catalogSchemas.CompanyContract, nullable: true, readOnly: true,
            description: 'Current active company contract: effectiveFrom <= now and effectiveUntil > now or null. Null when no contract is currently valid or the company is revoked. Included in company list, detail and mutation responses. Manage contracts through /api/v1/marketing/company-contracts.',
          },
          createdById: { type: 'string', format: 'uuid', nullable: true, readOnly: true, description: 'Creator user ID; nullable for historical records.' },
          updatedById: { type: 'string', format: 'uuid', nullable: true, readOnly: true, description: 'Last modifying user ID; null until updated.' },
          revoked: { type: 'boolean', example: false },
          version: { type: 'integer', minimum: 0, example: 0 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          _count: { type: 'object', required: ['staffs'], properties: { staffs: { type: 'integer', minimum: 0 } } },
        },
      },
      StaffTitle: { type: 'string', enum: ['mr', 'mrs'], example: 'mr' },
      CompanyType: {
        type: 'string', enum: ['PT', 'CV', 'FIRMA', 'KOPERASI', 'PERORANGAN'], example: 'PT',
        description: 'Bentuk badan usaha perusahaan. Nilai harus sesuai enum dan menggunakan huruf kapital.',
      },
      CompanyStaff: {
        type: 'object', required: ['id', 'companyId', 'name', 'normalizeName', 'title', 'telp', 'email', 'revoked', 'version', 'createdById', 'updatedById', 'createdAt', 'updatedAt', 'company'],
        properties: {
          id: { type: 'string', format: 'uuid' }, companyId: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'John Doe' },
          normalizeName: { type: 'string', readOnly: true, example: 'johndoe' },
          createdById: { type: 'string', format: 'uuid', nullable: true, readOnly: true, description: 'Creator user ID; nullable for historical records.' },
          updatedById: { type: 'string', format: 'uuid', nullable: true, readOnly: true, description: 'Last modifying user ID; null until updated.' },
          title: schemaRef('StaffTitle'),
          telp: { type: 'string', nullable: true, maxLength: 30, example: '+628123456789' },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 254 },
          revoked: { type: 'boolean', example: false },
          version: { type: 'integer', minimum: 0, example: 0 },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          company: {
            type: 'object', required: ['id', 'name', 'type', 'version'],
            properties: {
              id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
              type: schemaRef('CompanyType'), version: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
      ServiceScopeType: { type: 'string', enum: ['INSPECTION', 'MAINTENANCE'] },
      ServiceScope: {
        type: 'object', required: ['id', 'type', 'scope', 'revoked', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' }, serviceId: { type: 'string', format: 'uuid', nullable: true }, itemId: { type: 'string', format: 'uuid', nullable: true },
          type: { $ref: '#/components/schemas/ServiceScopeType' }, scope: { type: 'string' }, revoked: { type: 'boolean', example: false },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ServiceType: { type: 'string', enum: ['TUBULAR', 'OCTG', 'OTHER'], example: 'TUBULAR', description: 'Service type.' },
      Service: {
        type: 'object',
        required: ['id', 'officeBranchId', 'name', 'type', 'hasMaintenance', 'version', 'isActive', 'createdById', 'createdByName', 'createdAt', 'updatedAt', 'inspectionScopes', 'maintenanceScopes'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          officeBranchId: { type: 'string', format: 'uuid', readOnly: true, description: 'Owning branch, derived from the authenticated user.' },
          name: { type: 'string', example: 'Social Media Management' },
          type: schemaRef('ServiceType'),
          hasMaintenance: { type: 'boolean' },
          version: { type: 'integer', minimum: 0, description: 'Use this value for PATCH and DELETE optimistic locking.' },
          isActive: { type: 'boolean' },
          createdById: { type: 'string', format: 'uuid', readOnly: true },
          createdByName: { type: 'string', readOnly: true },
          updatedById: { type: 'string', format: 'uuid', nullable: true, readOnly: true },
          updatedByName: { type: 'string', nullable: true, readOnly: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          inspectionScopes: { type: 'array', items: { type: 'object', required: ['id', 'serviceId', 'inspectionScope', 'revoked', 'createdAt', 'updatedAt'], properties: {
            id: { type: 'string', format: 'uuid' }, serviceId: { type: 'string', format: 'uuid' }, inspectionScope: { type: 'string' }, revoked: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          } } },
          maintenanceScopes: { type: 'array', items: { type: 'object', required: ['id', 'serviceId', 'scope', 'revoked', 'createdAt', 'updatedAt'], properties: {
            id: { type: 'string', format: 'uuid' }, serviceId: { type: 'string', format: 'uuid' }, scope: { type: 'string' }, revoked: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          } } },
        },
      },
      ServiceListItem: {
        type: 'object',
        required: ['id', 'officeBranchId', 'name', 'type', 'hasMaintenance', 'version', 'isActive', 'createdById', 'createdByName', 'createdAt', 'updatedAt', 'inspectionScopes', 'maintenanceScopes'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          officeBranchId: { type: 'string', format: 'uuid', readOnly: true, description: 'Owning branch, derived from the authenticated user.' },
          name: { type: 'string', example: 'Social Media Management' },
          type: schemaRef('ServiceType'),
          hasMaintenance: { type: 'boolean' },
          version: { type: 'integer', minimum: 0 },
          isActive: { type: 'boolean' },
          createdById: { type: 'string', format: 'uuid', readOnly: true },
          createdByName: { type: 'string', readOnly: true },
          updatedById: { type: 'string', format: 'uuid', nullable: true, readOnly: true },
          updatedByName: { type: 'string', nullable: true, readOnly: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          inspectionScopes: { type: 'string', example: 'Planning, Execution', description: 'Active inspection scopes joined with a comma and one space.' },
          maintenanceScopes: { type: 'string', example: 'Inspection, Cleaning', description: 'Active maintenance scopes joined with a comma and one space.' },
        },
      },
      Item: {
        type: 'object', required: ['id', 'officeBranchId', 'name', 'uom', 'isActive', 'createdById', 'createdByName', 'updatedById', 'updatedByName', 'createdAt', 'updatedAt', 'sizes'],
        properties: {
          version: { type: 'integer', minimum: 0 },
          id: { type: 'string', format: 'uuid' },
          officeBranchId: { type: 'string', format: 'uuid', readOnly: true, description: 'Owning branch, derived from the authenticated user.' },
          serviceId: { type: 'string', format: 'uuid', nullable: true, description: 'Optional service owner. Null means this item is standalone.' },
          name: { type: 'string' },
          uom: { type: 'string', maxLength: 50, example: 'JOINT', description: 'Unit of measure. Existing items were initialized to JOINT.' },
          inspectionScopes: { type: 'array', items: { type: 'object', required: ['id', 'itemId', 'inspectionScope', 'revoked', 'createdAt', 'updatedAt'], properties: {
            id: { type: 'string', format: 'uuid' }, itemId: { type: 'string', format: 'uuid' }, inspectionScope: { type: 'string' }, revoked: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          } }, description: 'Inspection scope rows owned directly by this standalone item. Empty when serviceId is set.' },
          maintenanceScopes: { type: 'array', items: { type: 'object', required: ['id', 'itemId', 'scope', 'revoked', 'createdAt', 'updatedAt'], properties: {
            id: { type: 'string', format: 'uuid' }, itemId: { type: 'string', format: 'uuid' }, scope: { type: 'string' }, revoked: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          } }, description: 'Maintenance scope rows owned directly by this standalone item. Empty when serviceId is set.' },
          createdById: { type: 'string', format: 'uuid', readOnly: true },
          createdByName: { type: 'string', readOnly: true, description: 'Snapshot of the current user name when the item was created.' },
          updatedById: { type: 'string', format: 'uuid', nullable: true, readOnly: true },
          updatedByName: { type: 'string', nullable: true, readOnly: true, description: 'Snapshot of the current user name when the item was last changed.' },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          sizes: { type: 'array', items: schemaRef('ItemSize') },
          service: {
            type: 'object',
            nullable: true,
            description: 'Included by the item-detail endpoint; omitted by create, update, and deactivate responses.',
            required: ['id', 'name', 'hasMaintenance'],
            properties: {
              id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, hasMaintenance: { type: 'boolean' },
            },
          },
        },
      },
      ItemSizeListRow: {
        allOf: [schemaRef('ItemSize'), {
          type: 'object', required: ['item'],
          properties: {
            item: {
              allOf: [schemaRef('ItemListRow'), {
                type: 'object',
                properties: {
                  service: {
                    type: 'object', required: ['id', 'name', 'type', 'hasMaintenance'],
                    properties: {
                      id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
                      type: schemaRef('ServiceType'), hasMaintenance: { type: 'boolean' },
                    },
                  },
                },
              }],
            },
          },
        }],
      },
      ItemSize: {
        type: 'object',
        description: 'Item size with price values sourced from its one-to-one item_prices record.',
        required: ['id', 'itemId', 'size', 'priceServicePrimary', 'priceServiceSisterCompany', 'isActive', 'effectiveFrom', 'effectiveUntil', 'createdById', 'createdByName', 'updatedById', 'updatedByName', 'createdAt', 'updatedAt'],
        properties: {
          priceId: { type: 'string', format: 'uuid', nullable: true },
          priceVersion: { type: 'integer', nullable: true, minimum: 0 },
          itemVersion: { type: 'integer', minimum: 0, description: 'New parent version returned by POST size.' },
          priceStatus: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
          version: { type: 'integer', minimum: 0 },
          id: { type: 'string', format: 'uuid' },
          itemId: { type: 'string', format: 'uuid' },
          size: { type: 'string', nullable: true, maxLength: 100, description: 'Null marks a direct-price item that cannot accept additional sizes; use its ID for normal, sister-company and contract prices.' },
          effectiveFrom: { type: 'string', format: 'date-time', readOnly: true, description: 'Start of the item size validity period.' },
          effectiveUntil: { type: 'string', format: 'date-time', nullable: true, readOnly: true, description: 'End of the validity period; null while active.' },
          priceServicePrimary: { type: 'string', format: 'decimal', nullable: true, description: 'Service price for a primary company.' },
          priceServiceSisterCompany: { type: 'string', format: 'decimal', nullable: true, description: 'Service price for a sister company.' },
          priceMaintenancePrimary: { type: 'string', format: 'decimal', nullable: true, description: 'Maintenance price for a primary company.' },
          priceMaintenanceSisterCompany: { type: 'string', format: 'decimal', nullable: true, description: 'Maintenance price for a sister company.' },
          isActive: { type: 'boolean' },
          createdById: { type: 'string', format: 'uuid', readOnly: true },
          createdByName: { type: 'string', readOnly: true, description: 'Snapshot of the current user name when the item size was created.' },
          updatedById: { type: 'string', format: 'uuid', nullable: true, readOnly: true },
          updatedByName: { type: 'string', nullable: true, readOnly: true, description: 'Snapshot of the current user name when the item size was last changed.' },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ItemListRow: {
        type: 'object',
        description: 'Active Item row with optional service summary. Item sizes are intentionally not loaded.',
        required: ['id', 'officeBranchId', 'name', 'uom', 'isActive', 'createdById', 'createdByName', 'updatedById', 'updatedByName', 'createdAt', 'updatedAt'],
        properties: {
          version: { type: 'integer', minimum: 0 },
          id: { type: 'string', format: 'uuid' },
          officeBranchId: { type: 'string', format: 'uuid', readOnly: true },
          serviceId: { type: 'string', format: 'uuid', nullable: true, description: 'Optional service owner. Null means this item is standalone.' },
          name: { type: 'string' },
          uom: { type: 'string', maxLength: 50, example: 'JOINT', description: 'Unit of measure. Existing items were initialized to JOINT.' },
          isActive: { type: 'boolean', enum: [true] },
          createdById: { type: 'string', format: 'uuid', readOnly: true },
          createdByName: { type: 'string', readOnly: true },
          updatedById: { type: 'string', format: 'uuid', nullable: true, readOnly: true },
          updatedByName: { type: 'string', nullable: true, readOnly: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          service: { type: 'object', nullable: true, required: ['id', 'name'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } },
        },
      },
      ItemDetail: {
        allOf: [schemaRef('ItemListRow')],
        description: 'Active Item detail without item-size data.',
        properties: {
          version: { type: 'integer', minimum: 0 },
          service: {
            type: 'object', required: ['id', 'name', 'hasMaintenance'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              hasMaintenance: { type: 'boolean' },
            },
          },
        },
      },

      Pagination: {
        type: 'object',
        required: ['page', 'limit', 'total', 'totalPages'],
        properties: {
          page: { type: 'integer', minimum: 1 },
          limit: { type: 'integer', minimum: 1 },
          total: { type: 'integer', minimum: 0 },
          totalPages: { type: 'integer', minimum: 0 },
        },
      },
      CompanyResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: schemaRef('Company'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      CompanyListResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object',
            required: ['companies', 'pagination'],
            properties: {
              companies: { type: 'array', items: schemaRef('Company') },
              pagination: schemaRef('Pagination'),
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      CompanyStaffResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: schemaRef('CompanyStaff'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      CompanyStaffListResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object',
            required: ['staffs', 'pagination'],
            properties: {
              staffs: { type: 'array', items: schemaRef('CompanyStaff') },
              pagination: schemaRef('Pagination'),
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      ServiceResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: schemaRef('Service'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      ServiceHistoryResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] }, message: { type: 'string' },
          data: {
            type: 'object', required: ['serviceId', 'history', 'pagination'],
            properties: {
              serviceId: { type: 'string', format: 'uuid' },
              history: { type: 'array', items: {
                type: 'object', required: ['id', 'action', 'version', 'changedBy', 'changedAt', 'changes'],
                properties: {
                  id: { type: 'string', format: 'uuid' }, action: { type: 'string', example: 'INSPECTION_SCOPE_ADD' }, version: { type: 'integer', minimum: 0 },
                  changedBy: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } },
                  changedAt: { type: 'string', format: 'date-time' },
                  changes: { type: 'array', items: { type: 'object', required: ['field', 'label', 'before', 'after'], properties: { field: { type: 'string' }, label: { type: 'string' }, before: {}, after: {} } } },
                },
              } },
              pagination: schemaRef('Pagination'),
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      ServiceListResponse: {
        type: 'object',
        required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 },
          success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object',
            required: ['services', 'pagination'],
            properties: {
              services: { type: 'array', items: schemaRef('ServiceListItem') },
              pagination: schemaRef('Pagination'),
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      InspectionScopeResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] },
          message: { type: 'string' }, data: schemaRef('ServiceScope'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      MaintenanceScopeResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] },
          message: { type: 'string' }, data: schemaRef('ServiceScope'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      ItemResponse: {
        type: 'object', required: ['status', 'success', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] },
          data: schemaRef('Item'), requestId: { type: 'string', format: 'uuid' },
        },
      },
      ItemDetailResponse: {
        type: 'object', required: ['status', 'success', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] },
          data: schemaRef('ItemDetail'), requestId: { type: 'string', format: 'uuid' },
        },
      },
      ItemSizeResponse: {
        type: 'object', required: ['status', 'success', 'data'],
        properties: {
          status: { type: 'integer', example: 201 }, success: { type: 'boolean', enum: [true] },
          data: schemaRef('ItemSize'), requestId: { type: 'string', format: 'uuid' },
        },
      },
      ItemListResponse: {
        type: 'object', required: ['status', 'success', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object', required: ['items', 'pagination'],
            properties: {
              items: { type: 'array', items: schemaRef('ItemListRow') },
              pagination: schemaRef('Pagination'),
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      ItemSizeListResponse: {
        type: 'object', required: ['status', 'success', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object', required: ['sizes', 'pagination'],
            properties: {
              sizes: { type: 'array', items: schemaRef('ItemSizeListRow') },
              pagination: schemaRef('Pagination'),
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      CreateCompanyRequest: {
        type: 'object', required: ['name', 'type', 'address', 'npwp'], additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          type: schemaRef('CompanyType'),
          address: { type: 'string', minLength: 1, maxLength: 500 },
          npwp: { type: 'string', minLength: 1, maxLength: 32, example: '0012345678901234' },
          isSisterCompany: { type: 'boolean', default: false },
        },
      },
      UpdateCompanyRequest: {
        type: 'object', required: ['version'], minProperties: 2, additionalProperties: false,
        description: 'Supply the current version and at least one editable field. A stale version or inactive record returns 409.',
        properties: {
          version: { type: 'integer', minimum: 0, example: 0 },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          type: schemaRef('CompanyType'),
          address: { type: 'string', minLength: 1, maxLength: 500 },
          npwp: { type: 'string', minLength: 1, maxLength: 32, example: '0012345678901234' },
          isSisterCompany: { type: 'boolean' },
        },
      },
      CreateCompanyStaffRequest: {
        type: 'object', required: ['companyId', 'name', 'title'], additionalProperties: false,
        properties: {
          companyId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          title: schemaRef('StaffTitle'),
          telp: { type: 'string', nullable: true, minLength: 1, maxLength: 30 },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 254 },
        },
      },
      UpdateCompanyStaffRequest: {
        type: 'object', required: ['version'], minProperties: 2, additionalProperties: false,
        description: 'Supply the current version and at least one editable field. A staff member remains assigned to its original company; companyId cannot be changed. A stale version or inactive record returns 409.',
        properties: {
          version: { type: 'integer', minimum: 0, example: 0 },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          title: schemaRef('StaffTitle'),
          telp: { type: 'string', nullable: true, minLength: 1, maxLength: 30 },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 254 },
        },
      },
      DeactivateCompanyStaffRequest: {
        type: 'object', required: ['version'], additionalProperties: false,
        description: 'Current staff version for optimistic locking.',
        properties: { version: { type: 'integer', minimum: 0, example: 0 } },
      },
      CreateServiceRequest: {
        type: 'object', required: ['name', 'type', 'hasMaintenance'], additionalProperties: false,
        properties: {
          type: schemaRef('ServiceType'),
          name: { type: 'string', minLength: 1, maxLength: 200 },
          hasMaintenance: { type: 'boolean', description: 'When true, at least one maintenanceScopes item is required.' },
          inspectionScopes: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 500 }, default: [] },
          maintenanceScopes: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 500 }, default: [] },
        },
      },
      UpdateServiceRequest: {
        type: 'object', required: ['version'], minProperties: 2, additionalProperties: false,
        properties: {
          version: { type: 'integer', minimum: 0, example: 0, description: 'Current service version for optimistic locking.' },
          type: schemaRef('ServiceType'),
          name: { type: 'string', minLength: 1, maxLength: 200 },
          hasMaintenance: { type: 'boolean', description: 'Supplying false soft-deletes every active maintenance scope. Add or remove scopes through their dedicated endpoints.' },
        },
      },
      DeactivateServiceRequest: {
        type: 'object', required: ['version'], additionalProperties: false,
        description: 'Current service version for optimistic locking.',
        properties: { version: { type: 'integer', minimum: 0, example: 0 } },
      },
      CreateInspectionScopeRequest: {
        type: 'object', required: ['inspectionScope'], additionalProperties: false,
        properties: { inspectionScope: { type: 'string', minLength: 1, maxLength: 500 } },
      },
      CreateMaintenanceScopeRequest: {
        type: 'object', required: ['scope'], additionalProperties: false,
        properties: {
          scope: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      CreateItemRequest: {
        type: 'object', additionalProperties: false, required: ['name', 'uom'],
        description: 'Creates an item with an optional service. Standalone items may define inspectionScopes and maintenanceScopes; an item with serviceId cannot define scopes. Active item names are unique within the authenticated branch. Each sizes entry may include standard service/inspection and sister-company prices, plus both maintenance prices when the service has maintenance. Prices are created atomically with the sizes.',
        properties: {
          serviceId: { type: 'string', format: 'uuid', nullable: true },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          uom: { type: 'string', minLength: 1, maxLength: 50, example: 'JOINT', description: 'Required unit of measure; normalized and trimmed. Blank values are rejected.' },
          inspectionScopes: { type: 'array', maxItems: 100, uniqueItems: true, default: [], items: { type: 'string', minLength: 1, maxLength: 500 }, description: 'Allowed only when serviceId is omitted.' },
          maintenanceScopes: { type: 'array', maxItems: 100, uniqueItems: true, default: [], items: { type: 'string', minLength: 1, maxLength: 500 }, description: 'Allowed only when serviceId is omitted.' },
          sizes: { type: 'array', maxItems: 100, default: [], description: 'Empty or omitted creates one variant without a size. A size=null variant marks direct pricing and cannot coexist with additional sizes. Mixed null/named sizes return 409.', items: schemaRef('ItemSizeInput') },
        },
      },
      AddItemSizeRequest: {
        type: 'object', additionalProperties: false, required: ['itemId', 'itemVersion', 'size'],
        properties: {
          itemVersion: { type: 'integer', minimum: 0 },
          itemId: { type: 'string', format: 'uuid' },
          size: { type: 'string', nullable: true, minLength: 1, maxLength: 100, description: 'Use null for direct pricing. Direct-price items cannot accept additional sizes; named-size items cannot accept size=null. Blank strings are rejected.' },
        },
      },
      ItemSizeInput: {
        type: 'object', additionalProperties: false, required: ['size'],
        description: 'Reusable size reference. Active size labels are unique per item after normalization. Optionally provide priceServicePrimary, priceServiceSisterCompany, priceMaintenancePrimary, and priceMaintenanceSisterCompany, using the same validation as POST /items/sizes/{itemSizeId}/price. Primary service price is required if any price is supplied; maintenance-enabled services require both maintenance prices.',
        properties: {
          size: { type: 'string', nullable: true, minLength: 1, maxLength: 100, description: 'Use null for direct pricing. Direct-price items cannot accept additional sizes; named-size items cannot accept size=null. Blank strings are rejected.' },
          priceServicePrimary: { $ref: '#/components/schemas/CatalogPriceRequest/properties/priceServicePrimary' },
          priceServiceSisterCompany: { $ref: '#/components/schemas/CatalogPriceRequest/properties/priceServiceSisterCompany' },
          priceMaintenancePrimary: { $ref: '#/components/schemas/CatalogPriceRequest/properties/priceMaintenancePrimary' },
          priceMaintenanceSisterCompany: { $ref: '#/components/schemas/CatalogPriceRequest/properties/priceMaintenanceSisterCompany' },
        },
      },
    },
  },
  paths: {
    ...quotationPaths,
    ...taxPaths,
    ...userSyncPaths,
    ...operationalPaths,
    ...workOrderPaths,
    ...catalogPaths,
    '/health': {
      get: {
        tags: ['Gateway'],
        summary: 'Check gateway health',
        responses: {
          200: response('Gateway is healthy', schemaRef('GatewayHealthResponse')),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/services': {
      get: {
        tags: ['Gateway'],
        summary: 'List registered downstream services',
        responses: {
          200: response('Registered services', schemaRef('ServiceRegistryResponse')),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/api-docs': {
      get: {
        tags: ['Gateway'],
        summary: 'Open the interactive Swagger UI',
        responses: {
          200: {
            description: 'Swagger UI HTML',
            content: { 'text/html': { schema: { type: 'string' } } },
          },
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/api/v1/auth/health': {
      get: {
        tags: ['Authentication'],
        summary: 'Check Auth Service health through Gateway',
        description: 'Gateway injects the Auth-specific internal secret. Calling the Auth Service health endpoint directly is rejected.',
        responses: {
          200: response('Auth Service is healthy', schemaRef('DownstreamHealthResponse')),
          429: errorResponse('Rate limit exceeded'),
          503: errorResponse('Auth Service is unavailable'),
        },
      },
    },
    '/api/v1/app-manager/health': {
      get: {
        tags: ['App Manager'],
        summary: 'Check App Manager Service health through Gateway',
        description: 'Requires a valid access token at the Gateway. The Gateway injects the App Manager-specific internal secret.',
        security: protectedSecurity,
        responses: {
          200: response('App Manager Service is healthy', schemaRef('DownstreamHealthResponse')),
          401: errorResponse('Missing or invalid access token'),
          429: errorResponse('Rate limit exceeded'),
          503: errorResponse('App Manager Service is unavailable'),
        },
      },
    },
    '/api/v1/marketing/health': {
      get: {
        tags: ['Marketing'],
        summary: 'Check Marketing Service health through Gateway',
        description: 'Requires a valid access token at the Gateway. The Gateway injects the Marketing-specific internal secret.',
        security: protectedSecurity,
        responses: {
          200: response('Marketing Service is healthy', schemaRef('DownstreamHealthResponse')),
          401: errorResponse('Missing or invalid access token'),
          429: errorResponse('Rate limit exceeded'),
          503: errorResponse('Marketing Service is unavailable'),
        },
      },
    },
    '/api/v1/finance/health': {
      get: {
        tags: ['Finance'],
        summary: 'Check Finance Service health through Gateway',
        description: 'Requires a valid access token at the Gateway. The Gateway injects the Finance-specific internal secret.',
        security: protectedSecurity,
        responses: {
          200: response('Finance Service is healthy', schemaRef('DownstreamHealthResponse')),
          401: errorResponse('Missing or invalid access token'),
          429: errorResponse('Rate limit exceeded'),
          503: errorResponse('Finance Service is unavailable'),
        },
      },
    },
    '/api/v1/fieldservice/health': {
      get: {
        tags: ['Field Service'],
        summary: 'Check Field Service health through Gateway',
        description: 'Requires a valid access token at the Gateway. The Gateway injects the Field Service-specific internal secret.',
        security: protectedSecurity,
        responses: {
          200: response('Field Service is healthy', schemaRef('DownstreamHealthResponse')),
          401: errorResponse('Missing or invalid access token'),
          429: errorResponse('Rate limit exceeded'),
          503: errorResponse('Field Service is unavailable'),
        },
      },
    },
    '/api-docs.json': {
      get: {
        tags: ['Gateway'],
        summary: 'Get the raw OpenAPI document',
        responses: {
          200: response('OpenAPI document', {
            type: 'object',
            additionalProperties: true,
          }),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/api/v1/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register a user',
        description: 'Creates a user account without issuing access or refresh tokens and without starting a token session. Use the login endpoint after registration to authenticate.',
        requestBody: { required: true, ...jsonContent(schemaRef('RegisterRequest')) },
        responses: {
          201: response('User registered successfully without a token session', schemaRef('RegisterResponse')),
          400: errorResponse('Validation failed'),
          409: errorResponse('Username already registered'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/.well-known/jwks.json': {
      get: {
        tags: ['Authentication'],
        summary: 'Get public access-token signing keys',
        description: 'Returns the public RSA signing key set through the Gateway. Direct access to the Auth Service JWKS endpoint is rejected. Private signing keys are never exposed.',
        responses: {
          200: response('JSON Web Key Set', {
            type: 'object',
            required: ['keys'],
            properties: {
              keys: {
                type: 'array',
                items: { type: 'object', additionalProperties: true },
              },
            },
          }),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Authenticate a user and start a token session',
        description: 'Authenticates by username and sets an access token whose payload follows AccessTokenClaims, including the full name claim. The response body also carries the access token so development microfrontends can authenticate direct microservice calls; the refresh token remains httpOnly cookie only.',
        requestBody: { required: true, ...jsonContent(schemaRef('LoginRequest')) },
        responses: {
          200: { ...response('Login successful', schemaRef('AuthUserResponse')), headers: tokenCookieHeaders },
          400: errorResponse('Validation failed'),
          401: errorResponse('Invalid username or password'),
          403: errorResponse('Account is inactive'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/refresh-token': {
      post: {
        tags: ['Authentication'],
        summary: 'Rotate a refresh token and issue a new token pair',
        description: 'The refresh token is read only from the refreshToken cookie or x-refresh-token header. Rotation is rejected when the token is invalid, expired, revoked, reused, or exceeds the configured idle timeout (60 minutes by default). Every rejected token clears both accessToken and refreshToken cookies. A successful rotation records the latest activity time and returns the rotated access token in the response body for development microfrontends.',
        parameters: refreshTokenParameters,
        responses: {
          200: { ...response('Token refreshed', schemaRef('TokenRefreshResponse')), headers: tokenCookieHeaders },
          400: errorResponse('Refresh token is missing'),
          401: { ...errorResponse('Refresh token is invalid, expired, revoked, reused, or idle beyond the configured limit'), headers: clearedTokenCookieHeaders },
          403: { ...errorResponse('Account is inactive'), headers: clearedTokenCookieHeaders },
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Revoke the supplied refresh token and clear token cookies',
        description: 'The optional refresh token is read only from the refreshToken cookie or x-refresh-token header. Logout remains successful when no token is supplied.',
        parameters: refreshTokenParameters,
        responses: {
          200: { ...response('Logout successful', schemaRef('MessageResponse')), headers: clearedTokenCookieHeaders },
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get the authenticated user profile',
        security: protectedSecurity,
        responses: {
          200: userResponse('Profile retrieved'),
          401: errorResponse('Missing, invalid, expired, or non-access token'),
          403: errorResponse('Account is inactive'),
          404: errorResponse('User not found'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/profile': {
      put: {
        tags: ['Authentication'],
        summary: 'Update the authenticated user profile',
        description: 'Authentication is read from the accessToken cookie or Authorization header. Requires firstName and lastName; email and telp are optional. Omitted contact fields retain their values, explicit null clears them, and email is trimmed and normalized to lowercase.',
        security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateProfileRequest')) },
        responses: {
          200: userResponse('Profile updated'),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing, invalid, expired, or non-access token'),
          403: errorResponse('Account is inactive'),
          404: errorResponse('User not found'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/password': {
      put: {
        tags: ['Authentication'],
        summary: 'Change the authenticated user password',
        description: 'A successful password change revokes every active refresh token owned by the user.',
        security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('ChangePasswordRequest')) },
        responses: {
          200: userResponse('Password changed'),
          400: errorResponse('Validation failed, password confirmation differs, or current password is incorrect'),
          401: errorResponse('Missing, invalid, expired, or non-access token'),
          403: errorResponse('Account is inactive'),
          404: errorResponse('User not found'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/users': {
      get: {
        tags: ['User Management'],
        summary: 'List users',
        description: 'Proxied through the Gateway to Auth Service. Requires an active app manager account.',
        security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in username, firstName, and lastName.', schema: { type: 'string', minLength: 1, maxLength: 100 } },
          { in: 'query', name: 'role', schema: schemaRef('UserRole') },
          { in: 'query', name: 'section', schema: schemaRef('UserSection') },
          { in: 'query', name: 'officeBranchId', schema: { type: 'string', format: 'uuid' } },
          { in: 'query', name: 'isActive', schema: { type: 'string', enum: ['true', 'false'] } },
          ...listSortParameters(['username', 'firstName', 'lastName', 'role', 'section', 'officeBranchId', 'isActive', 'updatedAt']),
        ],
        responses: {
          200: response('Users retrieved', schemaRef('UserListResponse')),
          400: errorResponse('Invalid query parameters'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/users/field-service/inspectors': {
      get: {
        tags: ['User Management'],
        summary: 'Validate Field Service inspectors for the caller branch',
        description: 'Branch-scoped inspector validation used by Field Service when a work order starts. Auth is the source of truth: given a comma-separated list of user IDs (1-100 unique UUIDs), returns only the IDs that are currently active users with section FIELD_SERVICE in the caller branch, each with its canonical display name (firstName + lastName). IDs that are unknown, inactive, in another section, or in another branch are silently omitted so callers can compare the requested IDs against the returned set and display names. Requires an active account; the branch always comes from the authenticated caller, never from the request.',
        security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'ids', required: true, description: 'Comma-separated user IDs (max 100, unique UUIDs).', schema: { type: 'string', minLength: 1, maxLength: 4100, example: '00000000-0000-4000-8000-0000000000a1,00000000-0000-4000-8000-0000000000a2' } },
        ],
        responses: {
          200: response('Field Service inspectors validated', schemaRef('FieldServiceInspectorListResponse')),
          400: errorResponse('Invalid query parameters'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Access denied'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/users/sync/deliveries': {
      get: {
        tags: ['User Management'],
        summary: 'Monitor user-sync outbox delivery status',
        description: 'Read-only monitoring of the Auth user-sync outbox that pushes user snapshots to Marketing and Field Service. Requires an active account with role APP_MANAGER; section and office branch are not required and the listing is global across all branches. Before reading, up to five due retries are attempted so the status reflects the current outbox even when the background worker is idle. Pending deliveries are listed first, ordered by next retry time. `deliveredAt=null` means pending; failed deliveries retry automatically with exponential backoff capped at five minutes plus jitter.',
        security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'status', schema: { type: 'string', enum: ['pending', 'delivered'] } },
          { in: 'query', name: 'targetService', schema: { type: 'string', enum: ['marketing-service', 'fieldservice-service'] } },
          { in: 'query', name: 'userId', description: 'Only deliveries of the events belonging to this user.', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: response('User sync deliveries retrieved', schemaRef('UserSyncDeliveryListResponse')),
          400: errorResponse('Invalid query parameters'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/users/{userId}': {
      get: {
        tags: ['User Management'],
        summary: 'Get a user',
        security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'userId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: userResponse('User retrieved'),
          400: errorResponse('Invalid user ID'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('User not found'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['User Management'],
        summary: 'Update a user',
        description: 'Atomically updates role, section, office branch, and/or active status. The target must exist, match the supplied version, and be active. Self-role/status changes and removal of the last active app manager are rejected. Deactivation revokes active refresh tokens.',
        security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'userId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateUserRequest')) },
        responses: {
          200: userResponse('User updated'),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('User not found'),
          409: errorResponse('Inactive user, self-update, last-app-manager, or concurrent update conflict'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/users/marketing-contacts': {
      get: {
        tags: ['User Management'],
        summary: 'Get active Marketing admin contacts for the current branch',
        description: 'Read-only directory used by downstream services (Marketing quotation PDF footer). Branch derives from the authenticated user current database assignment. Query parameters do not override it. App manager role is not required. Returns at most 20 active ADMIN users in the MARKETING section of that branch, ordered by creation then ID. Users without a branch receive an empty contacts array.',
        security: protectedSecurity,
        responses: {
          200: response('Marketing contacts retrieved', { type: 'object', required: ['status', 'success', 'message', 'data'], properties: {
            status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] }, message: { type: 'string' },
            data: { type: 'object', required: ['contacts'], properties: { contacts: { type: 'array', items: { type: 'object', required: ['name'], properties: {
              name: { type: 'string', example: 'Artha' }, email: { type: 'string', format: 'email', nullable: true }, telp: { type: 'string', nullable: true },
            } } } } },
            requestId: { type: 'string', format: 'uuid' },
          } }),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Account is inactive'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/menus/my-menus': {
      get: {
        tags: ['App Manager'],
        summary: 'Get my menus',
        description: 'Returns active menu items granted by MenuAccess for the authenticated role and section, grouped by their parent menu. Null role and section values act as wildcards. Accessible by all active roles; no APP_MANAGER role is required.',
        security: protectedSecurity,
        responses: {
          200: response('Menus retrieved successfully', schemaRef('MyMenusResponse')),
          401: errorResponse('Missing/invalid token or account cannot be resolved as active'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/menus': {
      get: {
        tags: ['App Manager'],
        summary: 'List menus',
        security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'hasItem', schema: { type: 'string', enum: ['true', 'false'] } },
          { in: 'query', name: 'isActive', schema: { type: 'string', enum: ['true', 'false'] } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in key and label.', schema: { type: 'string', minLength: 1, maxLength: 100 } },
          ...listSortParameters(['key', 'label', 'hasItem', 'order', 'isActive', 'updatedAt']),
        ],
        responses: {
          200: response('Menus retrieved', schemaRef('MenuListResponse')),
          400: errorResponse('Invalid query parameters'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      post: {
        tags: ['App Manager'],
        summary: 'Create a menu',
        security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('CreateMenuRequest')) },
        responses: {
          201: response('Menu created', schemaRef('MenuResponse')),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          409: errorResponse('Menu or nested menu item key already exists'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/menus/{menuId}': {
      get: {
        tags: ['App Manager'],
        summary: 'Get a menu',
        security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Menu retrieved', schemaRef('MenuResponse')),
          400: errorResponse('Invalid menu ID'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('Menu not found'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['App Manager'],
        summary: 'Update a menu',
        description: 'Setting hasItem=false is rejected while any item, active or inactive, still belongs to the menu. Setting hasItem=true only enables subsequent item creation.',
        security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateMenuRequest')) },
        responses: {
          200: response('Menu updated', schemaRef('MenuResponse')),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('Menu not found'),
          409: errorResponse('Menu key already exists or hasItem conflicts with existing items'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['App Manager'],
        summary: 'Soft delete a menu',
        description: 'Retains the row and sets isDeleted=true and isActive=false. Returns 409 while undeleted items exist; delete their access rules and items first. Deleted menus cannot be updated or restored through PATCH. Menu keys remain reserved. Menu configuration is global and restricted to APP_MANAGER.',
        security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Menu deleted', schemaRef('MenuResponse')),
          409: errorResponse('Menu is already deleted or still has items'),
          400: errorResponse('Invalid menu ID'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('Menu not found'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/menu-accesses': {
      get: {
        tags: ['App Manager'], summary: 'List menu accesses', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'menuItemId', schema: { type: 'string', format: 'uuid' } },
          { in: 'query', name: 'role', schema: schemaRef('MenuAccessRole') },
          { in: 'query', name: 'section', schema: schemaRef('UserSection') },
          ...listSortParameters(['menuItemId', 'role', 'section', 'updatedAt']),
        ],
        responses: {
          200: response('Menu accesses retrieved', schemaRef('MenuAccessListResponse')),
          400: errorResponse('Invalid query parameters'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'), 429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      post: {
        tags: ['App Manager'], summary: 'Create a menu access', security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('CreateMenuAccessRequest')) },
        responses: {
          201: response('Menu access created', schemaRef('MenuAccessResponse')),
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'), 404: errorResponse('Menu item not found'),
          409: errorResponse('Menu access rule already exists'), 429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/menu-accesses/{menuAccessId}': {
      get: {
        tags: ['App Manager'], summary: 'Get a menu access', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuAccessId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Menu access retrieved', schemaRef('MenuAccessResponse')),
          400: errorResponse('Invalid menu access ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'), 404: errorResponse('Menu access not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['App Manager'], summary: 'Update a menu access', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuAccessId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateMenuAccessRequest')) },
        responses: {
          200: response('Menu access updated', schemaRef('MenuAccessResponse')),
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'), 404: errorResponse('Menu item or menu access not found'),
          409: errorResponse('Menu access rule already exists'), 429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['App Manager'], summary: 'Soft delete a menu access', security: protectedSecurity,
        description: 'Retains the rule with isDeleted=true and immediately excludes it from user permissions and active reads. Returns 409 if already deleted. The rule identity remains reserved. Global APP_MANAGER configuration.',
        parameters: [{ in: 'path', name: 'menuAccessId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Menu access deleted', schemaRef('MenuAccessResponse')),
          409: errorResponse('Menu access is already deleted'),
          400: errorResponse('Invalid menu access ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'), 404: errorResponse('Menu access not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/menu-items': {
      get: {
        tags: ['App Manager'],
        summary: 'List menu items',
        security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
          { in: 'query', name: 'menuId', schema: { type: 'string', format: 'uuid' } },
          { in: 'query', name: 'isActive', schema: { type: 'string', enum: ['true', 'false'] } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in key and label.', schema: { type: 'string', minLength: 1, maxLength: 100 } },
          ...listSortParameters(['menuId', 'key', 'label', 'order', 'isActive', 'updatedAt']),
        ],
        responses: {
          200: response('Menu items retrieved', schemaRef('MenuItemListResponse')),
          400: errorResponse('Invalid query parameters'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      post: {
        tags: ['App Manager'],
        summary: 'Create a menu item',
        security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('CreateMenuItemRequest')) },
        responses: {
          201: response('Menu item created', schemaRef('MenuItemResponse')),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('Parent menu not found'),
          409: errorResponse('Menu item key already exists or parent menu does not allow items'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/menu-items/{menuItemId}': {
      get: {
        tags: ['App Manager'],
        summary: 'Get a menu item',
        security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuItemId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Menu item retrieved', schemaRef('MenuItemResponse')),
          400: errorResponse('Invalid menu item ID'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('Menu item not found'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['App Manager'],
        summary: 'Update a menu item',
        security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuItemId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateMenuItemRequest')) },
        responses: {
          200: response('Menu item updated', schemaRef('MenuItemResponse')),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('Menu item or target menu not found'),
          409: errorResponse('Menu item key already exists or target menu does not allow items'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['App Manager'],
        summary: 'Soft delete a menu item',
        description: 'Retains the row and sets isDeleted=true and isActive=false. Returns 409 while undeleted access rules exist; delete those rules first. Deleted items cannot be updated or restored through PATCH. Item keys remain reserved. Global APP_MANAGER configuration.',
        security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuItemId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Menu item deleted', schemaRef('MenuItemResponse')),
          409: errorResponse('Menu item is already deleted or still has access rules'),
          400: errorResponse('Invalid menu item ID'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('Menu item not found'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/office-branches': {
      get: {
        tags: ['Reference'], summary: 'List office branches', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in office name, address, phone number, and email.', schema: { type: 'string', minLength: 1, maxLength: 100 } },
          { in: 'query', name: 'isHead', schema: { type: 'string', enum: ['true', 'false'] } },
          ...listSortParameters(['name', 'address', 'telp', 'email', 'isHead', 'updatedAt']),
        ],
        responses: {
          200: response('Office branches retrieved', schemaRef('OfficeBranchListResponse')),
          400: errorResponse('Invalid query parameters'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'), 429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      post: {
        tags: ['Reference'], summary: 'Create an office branch', security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('CreateOfficeBranchRequest')) },
        responses: {
          201: response('Office branch created', schemaRef('OfficeBranchResponse')),
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'), 429: errorResponse('Rate limit exceeded'),
          409: errorResponse('A head office branch already exists'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/office-branches/options': {
      get: {
        tags: ['Reference'],
        summary: 'List office branch options',
        description: 'Returns a compact list for select controls, ordered with the head office first and then by name.',
        security: protectedSecurity,
        responses: {
          200: response('Office branch options retrieved', schemaRef('OfficeBranchOptionsResponse')),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/app-manager/office-branches/{officeBranchId}': {
      get: {
        tags: ['Reference'], summary: 'Get an office branch', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'officeBranchId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Office branch retrieved', schemaRef('OfficeBranchResponse')),
          400: errorResponse('Invalid office branch ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'), 404: errorResponse('Office branch not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['Reference'], summary: 'Update an office branch', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'officeBranchId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateOfficeBranchRequest')) },
        responses: {
          200: response('Office branch updated', schemaRef('OfficeBranchResponse')),
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'), 404: errorResponse('Office branch not found'),
          409: errorResponse('A head office branch already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/companies': {
      get: {
        tags: ['Marketing'], summary: 'List companies', description: 'Returns only companies owned by the office branch in the access token.', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in name, type, and address.', schema: { type: 'string', minLength: 1, maxLength: 100 } },
          { in: 'query', name: 'isSisterCompany', schema: { type: 'string', enum: ['true', 'false'] } },
          ...listSortParameters(['name', 'type', 'address', 'isSisterCompany', 'version', 'updatedAt']),
        ],
        responses: {
          200: { description: 'Companies retrieved', ...jsonContent(schemaRef('CompanyListResponse')) },
          400: errorResponse('Invalid query parameters'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      post: {
        tags: ['Marketing'], summary: 'Create a company', security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('CreateCompanyRequest')) },
        responses: {
          201: { description: 'Company created', ...jsonContent(schemaRef('CompanyResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'),
          409: errorResponse('Normalized company name already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/companies/{companyId}': {
      get: {
        tags: ['Marketing'], summary: 'Get a company', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'companyId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Company retrieved', ...jsonContent(schemaRef('CompanyResponse')) },
          400: errorResponse('Invalid company ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['Marketing'], summary: 'Update company profile with a stable ID', description: 'Requires the current version and editable fields. Updates the same company ID and appends CompanyHistory atomically. Staff, contract and price IDs remain unchanged. NPWP cannot be null or blank.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'companyId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateCompanyRequest')) },
        responses: {
          200: { description: 'Company updated', ...jsonContent(schemaRef('CompanyResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company not found'),
          409: errorResponse('Version mismatch, inactive record, or normalized company or staff name already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/company-staffs': {
      get: {
        tags: ['Marketing'], summary: 'List company staff', description: 'Returns staff whose company belongs to the office branch in the access token.', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'companyId', schema: { type: 'string', format: 'uuid' } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in staff name, telephone, and email.', schema: { type: 'string', minLength: 1, maxLength: 100 } },
          { in: 'query', name: 'title', schema: schemaRef('StaffTitle') },
          ...listSortParameters(['companyId', 'name', 'title', 'version', 'updatedAt']),
        ],
        responses: {
          200: { description: 'Company staff retrieved', ...jsonContent(schemaRef('CompanyStaffListResponse')) },
          400: errorResponse('Invalid query parameters'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      post: {
        tags: ['Marketing'], summary: 'Create company staff', security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('CreateCompanyStaffRequest')) },
        responses: {
          201: { description: 'Company staff created', ...jsonContent(schemaRef('CompanyStaffResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company not found'),
          409: errorResponse('Normalized company staff name already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/company-staffs/{companyStaffId}': {
      get: {
        tags: ['Marketing'], summary: 'Get company staff', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'companyStaffId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Company staff retrieved', ...jsonContent(schemaRef('CompanyStaffResponse')) },
          400: errorResponse('Invalid staff ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company staff not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['Marketing'], summary: 'Update company staff', description: 'Requires the current staff version. Updates the existing record without changing its company assignment, increments its version, and records the change in staff history.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'companyStaffId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateCompanyStaffRequest')) },
        responses: {
          200: { description: 'Company staff updated', ...jsonContent(schemaRef('CompanyStaffResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company or staff not found'),
          409: errorResponse('Version mismatch, inactive staff or company, or normalized company staff name already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['Marketing'], summary: 'Revoke company staff', description: 'Sets revoked to true and increments the staff version instead of deleting the row.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'companyStaffId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('DeactivateCompanyStaffRequest')) },
        responses: {
          200: { description: 'Company staff deleted', ...jsonContent(schemaRef('CompanyStaffResponse')) },
          400: errorResponse('Invalid staff ID or version body'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company staff not found'),
          409: errorResponse('Version mismatch or inactive record'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services': {
      get: {
        tags: ['Marketing'], summary: 'List services', description: 'Returns only services owned by the office branch in the access token. Only ADMIN may view inactive services. All other roles always use isActive=true, overriding isActive=false. ADMIN may omit isActive for both states or filter either state. Pagination counts follow the enforced filter.', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'name', description: 'Case-insensitive partial match on name.', schema: { type: 'string', minLength: 1, maxLength: 200 } },
          { in: 'query', name: 'isActive', schema: { type: 'string', enum: ['true', 'false'] } },
          { in: 'query', name: 'type', description: 'Exact service type match: TUBULAR, OCTG, or OTHER.', schema: schemaRef('ServiceType') },
          ...listSortParameters(['name', 'type', 'isActive']),
        ],
        responses: {
          200: { description: 'Services retrieved', ...jsonContent(schemaRef('ServiceListResponse')) },
          400: errorResponse('Invalid query parameters'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      post: {
        tags: ['Marketing'], summary: 'Create a service', security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('CreateServiceRequest')) },
        responses: {
          201: { description: 'Service created', ...jsonContent(schemaRef('ServiceResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services/{serviceId}': {
      get: {
        tags: ['Marketing'], summary: 'Get a service', description: 'Returns active and inactive services in the authenticated branch. Inactive services and their catalog children cannot be modified. A missing ID or a service in another branch returns 404.', security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Service retrieved', ...jsonContent(schemaRef('ServiceResponse')) },
          400: errorResponse('Invalid service ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['Marketing'], summary: 'Update a service', description: 'Requires an active service; inactive services return 409. Scopes are managed only through the dedicated add and soft-delete endpoints. Submit the current version to prevent lost updates.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateServiceRequest')) },
        responses: {
          200: { description: 'Service updated', ...jsonContent(schemaRef('ServiceResponse')) },
          409: errorResponse('Service is inactive or version mismatch'),
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['Marketing'], summary: 'Deactivate a service', description: 'Sets isActive=false and deactivates associated standard prices. Contract prices and their catalog snapshots remain unchanged; no contracts are created or revised. Requires the current service version.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('DeactivateServiceRequest')) },
        responses: {
          200: { description: 'Service deactivated', ...jsonContent(schemaRef('ServiceResponse')) },
          400: errorResponse('Invalid service ID or version body'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'),
          409: errorResponse('Service is already inactive'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services/{serviceId}/history': {
      get: {
        tags: ['Marketing'], summary: 'Get user-friendly service history', description: 'Shows service and scope changes as readable before/after values. Scope changes are recorded under the parent service.', security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } },
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: { description: 'Service history retrieved', ...jsonContent(schemaRef('ServiceHistoryResponse')) },
          400: errorResponse('Invalid service ID or pagination'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services/{serviceId}/inspection/scopes': {
      post: {
        tags: ['Marketing'], summary: 'Add a inspection scope', description: 'A revoked scope with the same text is reused. Each add is recorded in the parent service audit trail.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('CreateInspectionScopeRequest')) },
        responses: {
          201: { description: 'Inspection scope created', ...jsonContent(schemaRef('InspectionScopeResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'),
          409: errorResponse('Service is inactive or the active scope already exists'), 429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services/{serviceId}/inspection/scopes/{inspectionScopeId}': {
      delete: {
        tags: ['Marketing'], summary: 'Soft delete a inspection scope', description: 'Sets revoked to true instead of deleting the row. The parent service audit trail records the removal.', security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } },
          { in: 'path', name: 'inspectionScopeId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Inspection scope soft deleted', ...jsonContent(schemaRef('InspectionScopeResponse')) },
          400: errorResponse('Invalid ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service or inspection scope not found'),
          409: errorResponse('Service is inactive or scope is already deleted'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services/{serviceId}/maintenance/scopes': {
      post: {
        tags: ['Marketing'], summary: 'Add a maintenance scope for a service', description: 'A revoked scope with the same text is reused. Each add is recorded in the parent service audit trail.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('CreateMaintenanceScopeRequest')) },
        responses: {
          201: { description: 'Maintenance scope created', ...jsonContent(schemaRef('MaintenanceScopeResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'),
          409: errorResponse('Service is inactive, does not provide maintenance, or the active maintenance scope already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services/{serviceId}/maintenance/scopes/{scopeId}': {
      delete: {
        tags: ['Marketing'], summary: 'Soft delete a maintenance scope for a service', description: 'Sets revoked to true instead of deleting the row. The parent service audit trail records the removal.', security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } },
          { in: 'path', name: 'scopeId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Maintenance scope soft deleted', ...jsonContent(schemaRef('MaintenanceScopeResponse')) },
          400: errorResponse('Invalid ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service or maintenance scope not found'),
          409: errorResponse('Service is inactive, does not provide maintenance, or scope is already deleted'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
  },
});
