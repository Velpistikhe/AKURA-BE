import { env } from '../config/env.js';

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

const listSortParameters = (fields: string[]) => [
  {
    in: 'query', name: 'sortBy',
    description: 'Allowlisted field used for sorting. When omitted, results are sorted by createdAt descending; createdAt cannot be requested explicitly.',
    schema: { type: 'string', enum: fields },
  },
  {
    in: 'query', name: 'sortOrder',
    description: 'Sort direction.',
    schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
  },
];

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Akura API Gateway',
    version: '2.0.0',
    description: 'HTTP API for the Akura gateway, authentication, application management, and marketing services.',
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: 'Local API Gateway',
    },
  ],
  tags: [
    { name: 'Gateway', description: 'Gateway diagnostics and registered services.' },
    { name: 'Authentication', description: 'Registration, sessions, profile, and password management.' },
    { name: 'User Management', description: 'User administration owned and served directly by Auth Service.' },
    { name: 'App Manager', description: 'Administrative menu and application management.' },
    { name: 'Marketing', description: 'Company and marketing service management.' },
  ],
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
        required: ['sub', 'name', 'username', 'role', 'type', 'iss', 'aud', 'iat', 'exp'],
        properties: {
          sub: { type: 'string', format: 'uuid', description: 'User ID.' },
          name: { type: 'string', example: 'John Doe', description: 'Full name composed from firstName and lastName.' },
          username: { type: 'string', example: 'johndoe' },
          role: schemaRef('UserRole'),
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
        required: ['key', 'label', 'path', 'order'],
        properties: {
          key: { type: 'string', example: 'users_list', description: 'Unique slug identifier.' },
          label: { type: 'string', example: 'Daftar Pengguna' },
          path: { type: 'string', example: '/app-manager/users', description: 'Frontend route path.' },
          order: { type: 'integer', example: 1 },
        },
      },
      Menu: {
        type: 'object',
        description: 'An active navigation menu group containing items accessible to the authenticated user.',
        required: ['key', 'label', 'order', 'items'],
        properties: {
          key: { type: 'string', example: 'app_manager', description: 'Unique slug identifier.' },
          label: { type: 'string', example: 'App Manager' },
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
              order: 1,
              items: [
                {
                  key: 'users_list',
                  label: 'Daftar Pengguna',
                  path: '/app-manager/users',
                  order: 1,
                },
              ],
            },
          ],
          requestId: '9539c2ec-d85b-4fa1-94a1-ca7627f1fe6a',
        },
      },
      UserProfile: {
        type: 'object',
        required: [
          'id', 'username', 'firstName', 'lastName', 'role', 'section', 'isActive',
          'version', 'createdAt', 'updatedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          username: { type: 'string', example: 'johndoe' },
          firstName: { type: 'string', example: 'John' },
          lastName: { type: 'string', example: 'Doe' },
          role: schemaRef('UserRole'),
          section: schemaRef('NullableUserSection'),
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
            required: ['user'],
            properties: { user: schemaRef('UserProfile') },
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
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'johndoe' },
          password: { type: 'string', format: 'password', minLength: 1, example: 'securePassword123' },
        },
      },
      RefreshRequest: {
        type: 'object',
        properties: {
          refreshToken: {
            type: 'string',
            description: 'JWT containing a random id, user id in sub, and type=refresh.',
          },
        },
      },
      UpdateProfileRequest: {
        type: 'object',
        required: ['firstName', 'lastName'],
        properties: {
          firstName: { type: 'string', minLength: 1, example: 'John' },
          lastName: { type: 'string', minLength: 1, example: 'Doe' },
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
      SetUserRoleRequest: {
        type: 'object',
        required: ['role', 'version'],
        properties: {
          role: schemaRef('UserRole'),
          version: { type: 'integer', minimum: 1 },
        },
      },
      SetUserSectionRequest: {
        type: 'object',
        required: ['section', 'version'],
        properties: {
          section: schemaRef('NullableUserSection'),
          version: { type: 'integer', minimum: 1 },
        },
      },
      SetUserStatusRequest: {
        type: 'object',
        required: ['isActive', 'version'],
        properties: {
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
      ManagedMenu: {
        type: 'object',
        description: 'A menu record managed by an app manager.',
        required: ['id', 'key', 'label', 'order', 'isActive', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          key: { type: 'string', example: 'app_manager' },
          label: { type: 'string', example: 'App Manager' },
          order: { type: 'integer', example: 1 },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      MenuAccess: {
        type: 'object', required: ['role', 'section'],
        properties: {
          id: { type: 'string', format: 'uuid', readOnly: true },
          role: schemaRef('NullableMenuAccessRole'),
          section: schemaRef('NullableUserSection'),
        },
        description: 'Grants access to a menu item. A null role applies to every role and a null section applies to every section.',
      },
      ManagedMenuAccess: {
        type: 'object',
        required: ['id', 'menuItemId', 'role', 'section', 'createdAt', 'updatedAt', 'menuItem'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          menuItemId: { type: 'string', format: 'uuid' },
          role: schemaRef('NullableMenuAccessRole'),
          section: schemaRef('NullableUserSection'),
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
        type: 'object', required: ['menuItemId'],
        properties: {
          menuItemId: { type: 'string', format: 'uuid' },
          role: schemaRef('NullableMenuAccessRole'),
          section: schemaRef('NullableUserSection'),
        },
      },
      UpdateMenuAccessRequest: {
        type: 'object', minProperties: 1,
        properties: {
          menuItemId: { type: 'string', format: 'uuid' },
          role: schemaRef('NullableMenuAccessRole'),
          section: schemaRef('NullableUserSection'),
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
        type: 'object',
        required: ['key', 'label'],
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$', example: 'app_manager', description: 'Unique slug key.' },
          label: { type: 'string', minLength: 1, maxLength: 200, example: 'App Manager' },
          order: { type: 'integer', minimum: 0, default: 0 },
        },
      },
      UpdateMenuRequest: {
        type: 'object',
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$', example: 'app_manager' },
          label: { type: 'string', minLength: 1, maxLength: 200, example: 'App Manager' },
          order: { type: 'integer', minimum: 0 },
          isActive: { type: 'boolean' },
        },
      },
      ManagedMenuItem: {
        type: 'object',
        description: 'A menu item record managed by an app manager.',
        required: ['id', 'menuId', 'key', 'label', 'path', 'order', 'isActive', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          menuId: { type: 'string', format: 'uuid' },
          key: { type: 'string', example: 'users_list' },
          label: { type: 'string', example: 'Daftar Pengguna' },
          path: { type: 'string', example: '/app-manager/users' },
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
        required: ['menuId', 'key', 'label', 'path'],
        properties: {
          menuId: { type: 'string', format: 'uuid', description: 'ID of the parent menu.' },
          key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$', example: 'users_list', description: 'Unique slug key.' },
          label: { type: 'string', minLength: 1, maxLength: 200, example: 'Daftar Pengguna' },
          path: { type: 'string', minLength: 1, maxLength: 500, example: '/app-manager/users', description: 'Frontend route path.' },
          order: { type: 'integer', minimum: 0, default: 0 },
          role: { ...schemaRef('NullableMenuAccessRole'), deprecated: true, description: 'Legacy compatibility field. Accepted but not stored; configure access on the parent menu through accesses.' },
          section: { ...schemaRef('NullableUserSection'), deprecated: true, description: 'Legacy compatibility field. Accepted but not stored; configure access on the parent menu through accesses.' },
        },
      },
      UpdateMenuItemRequest: {
        type: 'object',
        properties: {
          menuId: { type: 'string', format: 'uuid' },
          key: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z0-9_-]+$', example: 'users_list' },
          label: { type: 'string', minLength: 1, maxLength: 200, example: 'Daftar Pengguna' },
          path: { type: 'string', minLength: 1, maxLength: 500, example: '/app-manager/users' },
          order: { type: 'integer', minimum: 0 },
          isActive: { type: 'boolean' },
          role: { ...schemaRef('NullableMenuAccessRole'), deprecated: true, description: 'Legacy compatibility field. Accepted but not stored; configure access on the parent menu through accesses.' },
          section: { ...schemaRef('NullableUserSection'), deprecated: true, description: 'Legacy compatibility field. Accepted but not stored; configure access on the parent menu through accesses.' },
        },
      },
      Company: {
        type: 'object',
        required: ['id', 'name', 'normalizeName', 'type', 'address', 'hasContract', 'revoked', 'version', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'PT Akura Indonesia' },
          normalizeName: { type: 'string', readOnly: true, example: 'ptakuraindonesia' },
          type: { type: 'string', example: 'CUSTOMER' },
          address: { type: 'string', example: 'Jakarta' },
          hasContract: { type: 'boolean', example: true },
          revoked: { type: 'boolean', example: false },
          version: { type: 'integer', minimum: 0, example: 0 },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          _count: { type: 'object', properties: { staffs: { type: 'integer' } } },
        },
      },
      StaffTitle: { type: 'string', enum: ['mr', 'mrs'], example: 'mr' },
      CompanyStaff: {
        type: 'object', required: ['id', 'companyId', 'name', 'normalizeName', 'title', 'revoked', 'version', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' }, companyId: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'John Doe' },
          normalizeName: { type: 'string', readOnly: true, example: 'johndoe' },
          title: schemaRef('StaffTitle'),
          telp: { type: 'string', nullable: true, maxLength: 30, example: '+628123456789' },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 254 },
          revoked: { type: 'boolean', example: false },
          version: { type: 'integer', minimum: 0, example: 0 },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          company: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } },
        },
      },
      ServiceScope: {
        type: 'object', required: ['id', 'serviceId', 'scope', 'revoked', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' }, serviceId: { type: 'string', format: 'uuid' },
          scope: { type: 'string' }, revoked: { type: 'boolean', example: false },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Service: {
        type: 'object',
        required: ['id', 'code', 'name', 'hasService', 'isActive', 'createdAt', 'updatedAt', 'scopes'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          code: { type: 'string', example: 'SOCIAL_MEDIA' },
          name: { type: 'string', example: 'Social Media Management' },
          hasService: { type: 'boolean' },
          maintenance: { allOf: [{ $ref: '#/components/schemas/Maintenance' }], nullable: true },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          scopes: { type: 'array', items: schemaRef('ServiceScope') },
        },
      },
      ServiceListItem: {
        type: 'object',
        required: ['id', 'code', 'name', 'hasService', 'isActive', 'createdAt', 'updatedAt', 'scopes'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          code: { type: 'string', example: 'SOCIAL_MEDIA' },
          name: { type: 'string', example: 'Social Media Management' },
          hasService: { type: 'boolean' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          scopes: { type: 'string', example: 'Planning, Execution', description: 'Active scopes joined with a comma and one space.' },
        },
      },
      Maintenance: {
        type: 'object', required: ['id', 'name', 'isActive', 'createdAt', 'updatedAt', 'scopes'],
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          scopes: { type: 'array', items: schemaRef('MaintenanceScope') },
        },
      },
      MaintenanceListItem: {
        type: 'object',
        required: ['id', 'name', 'isActive', 'createdAt', 'updatedAt', 'scopes'],
        properties: {
          id: { type: 'string', format: 'uuid' }, name: { type: 'string' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          scopes: { type: 'string', example: 'Inspection, Cleaning', description: 'Active scopes joined with a comma and one space.' },
        },
      },
      Item: {
        type: 'object', required: ['id', 'name', 'isActive', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          serviceId: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          sizes: { type: 'array', items: schemaRef('ItemSize') },
        },
      },
      ItemSize: {
        type: 'object',
        required: ['id', 'itemId', 'size', 'priceServicePrimary', 'priceServiceSisterCompany', 'isActive', 'version', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          itemId: { type: 'string', format: 'uuid' },
          size: { type: 'string', maxLength: 100 },
          priceServicePrimary: { type: 'string', format: 'decimal' },
          priceServiceSisterCompany: { type: 'string', format: 'decimal' },
          priceMaintenancePrimary: { type: 'string', format: 'decimal', nullable: true },
          priceMaintenanceSisterCompany: { type: 'string', format: 'decimal', nullable: true },
          isActive: { type: 'boolean' }, version: { type: 'integer', minimum: 1 },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ItemListRow: {
        allOf: [schemaRef('ItemSize')],
        properties: {
          item: {
            type: 'object', required: ['id', 'serviceId', 'name', 'service'],
            properties: {
              id: { type: 'string', format: 'uuid' }, serviceId: { type: 'string', format: 'uuid' }, name: { type: 'string' },
              service: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } },
            },
          },
        },
      },
      MaintenanceScope: {
        type: 'object', required: ['id', 'maintenanceId', 'scope', 'revoked', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' }, maintenanceId: { type: 'string', format: 'uuid' },
          scope: { type: 'string' }, revoked: { type: 'boolean', example: false },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ItemPriceVersion: {
        type: 'object',
        required: ['itemId', 'price', 'quantity', 'satuan', 'isActive', 'version', 'createdAt'],
        properties: {
          itemId: { type: 'string', format: 'uuid' },
          serviceId: { type: 'string', format: 'uuid' },
          maintenanceId: { type: 'string', format: 'uuid' },
          price: { type: 'string', format: 'decimal' },
          quantity: { type: 'string', format: 'decimal' },
          satuan: { type: 'string' }, isActive: { type: 'boolean' },
          version: { type: 'integer', minimum: 1 }, createdAt: { type: 'string', format: 'date-time' },
        },
        description: 'Versioned item relation. An edit inserts a new row with the next version instead of replacing the previous row.',
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
      MaintenanceResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] },
          message: { type: 'string' }, data: schemaRef('Maintenance'),
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      MaintenanceListResponse: {
        type: 'object', required: ['status', 'success', 'message', 'data'],
        properties: {
          status: { type: 'integer', example: 200 }, success: { type: 'boolean', enum: [true] },
          message: { type: 'string' },
          data: {
            type: 'object', required: ['maintenances', 'pagination'],
            properties: {
              maintenances: { type: 'array', items: schemaRef('MaintenanceListItem') },
              pagination: schemaRef('Pagination'),
            },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
      ServiceScopeResponse: {
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
          message: { type: 'string' }, data: schemaRef('MaintenanceScope'),
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
      CreateCompanyRequest: {
        type: 'object', required: ['name', 'type', 'address'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          type: { type: 'string', minLength: 1, maxLength: 100 },
          address: { type: 'string', minLength: 1, maxLength: 500 },
          hasContract: { type: 'boolean', default: false },
        },
      },
      UpdateCompanyRequest: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          type: { type: 'string', minLength: 1, maxLength: 100 },
          address: { type: 'string', minLength: 1, maxLength: 500 },
          hasContract: { type: 'boolean' },
        },
      },
      CreateCompanyStaffRequest: {
        type: 'object', required: ['companyId', 'name', 'title'],
        properties: {
          companyId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          title: schemaRef('StaffTitle'),
          telp: { type: 'string', nullable: true, minLength: 1, maxLength: 30 },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 254 },
        },
      },
      UpdateCompanyStaffRequest: {
        type: 'object',
        properties: {
          companyId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          title: schemaRef('StaffTitle'),
          telp: { type: 'string', nullable: true, minLength: 1, maxLength: 30 },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 254 },
        },
      },
      CreateServiceRequest: {
        type: 'object', required: ['code', 'name', 'hasService'],
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[A-Z0-9_-]+$' },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          hasService: { type: 'boolean', description: 'When true, maintenance is required.' },
          maintenance: { $ref: '#/components/schemas/CreateMaintenanceRequest' },
          scopes: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 500 }, default: [] },
        },
      },
      UpdateServiceRequest: {
        type: 'object',
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[A-Z0-9_-]+$' },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          isActive: { type: 'boolean' },
        },
      },
      CreateMaintenanceRequest: {
        type: 'object', required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          scopes: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 500 }, default: [] },
        },
      },
      CreateScopeRequest: {
        type: 'object', required: ['scope'], additionalProperties: false,
        properties: {
          scope: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      CreateItemRequest: {
        type: 'object', additionalProperties: false, required: ['serviceId', 'name', 'sizes'],
        properties: {
          serviceId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          sizes: { type: 'array', minItems: 1, maxItems: 100, items: schemaRef('ItemSizeInput') },
        },
      },
      UpdateItemRequest: {
        type: 'object', additionalProperties: false, required: ['serviceId', 'name', 'sizes'],
        properties: {
          serviceId: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          sizes: { type: 'array', minItems: 1, maxItems: 100, items: schemaRef('ItemSizeInput') },
        },
      },
      ItemSizeInput: {
        type: 'object', additionalProperties: false,
        required: ['size', 'priceServicePrimary', 'priceServiceSisterCompany'],
        properties: {
          size: { type: 'string', minLength: 1, maxLength: 100 },
          priceServicePrimary: { type: 'number', minimum: 0 },
          priceServiceSisterCompany: { type: 'number', minimum: 0 },
          priceMaintenancePrimary: { type: 'number', minimum: 0, nullable: true },
          priceMaintenanceSisterCompany: { type: 'number', minimum: 0, nullable: true },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Gateway'],
        summary: 'Check gateway health',
        responses: {
          200: response('Gateway is healthy', {
            type: 'object',
            additionalProperties: true,
          }),
          429: errorResponse('Rate limit exceeded'),
        },
      },
    },
    '/services': {
      get: {
        tags: ['Gateway'],
        summary: 'List registered downstream services',
        responses: {
          200: response('Registered services', {
            type: 'object',
            additionalProperties: true,
          }),
          429: errorResponse('Rate limit exceeded'),
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
        description: 'Returns the public RSA signing key set. Private signing keys are never exposed.',
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
        description: 'Authenticates by username and sets an access token whose payload follows AccessTokenClaims, including the full name claim.',
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
        description: 'The refresh token can be supplied through the refreshToken cookie or request body. Rotation is rejected when the token is invalid, expired, revoked, reused, or exceeds the configured idle timeout (60 minutes by default). Every rejected token clears both accessToken and refreshToken cookies. A successful rotation records the latest activity time.',
        requestBody: { required: false, ...jsonContent(schemaRef('RefreshRequest')) },
        responses: {
          200: { ...response('Token refreshed', schemaRef('MessageResponse')), headers: tokenCookieHeaders },
          400: errorResponse('Refresh token is missing'),
          401: { ...errorResponse('Refresh token is invalid, expired, revoked, reused, or idle beyond the configured limit'), headers: clearedTokenCookieHeaders },
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Revoke the supplied refresh token and clear token cookies',
        requestBody: { required: false, ...jsonContent(schemaRef('RefreshRequest')) },
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
        security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateProfileRequest')) },
        responses: {
          200: userResponse('Profile updated'),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing, invalid, expired, or non-access token'),
          404: errorResponse('User not found'),
          409: errorResponse('Concurrent update conflict'),
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
          404: errorResponse('User not found'),
          409: errorResponse('Concurrent update conflict'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/users': {
      get: {
        tags: ['User Management'],
        summary: 'List users',
        description: 'Served directly by Auth Service. Requires an active app manager account.',
        security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in username, firstName, and lastName.', schema: { type: 'string', maxLength: 100 } },
          { in: 'query', name: 'role', schema: schemaRef('UserRole') },
          { in: 'query', name: 'section', schema: schemaRef('UserSection') },
          { in: 'query', name: 'isActive', schema: { type: 'boolean' } },
          ...listSortParameters(['username', 'firstName', 'lastName', 'role', 'section', 'isActive', 'updatedAt']),
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
    },
    '/api/v1/auth/users/{userId}/role': {
      patch: {
        tags: ['User Management'],
        summary: 'Set a user role',
        description: 'App managers cannot change their own role or demote the last active app manager.',
        security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'userId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: { required: true, ...jsonContent(schemaRef('SetUserRoleRequest')) },
        responses: {
          200: userResponse('User role updated'),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('User not found'),
          409: errorResponse('Self-update, last-app-manager, or concurrent update conflict'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/users/{userId}/section': {
      patch: {
        tags: ['User Management'],
        summary: 'Set or clear a user section',
        security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'userId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: { required: true, ...jsonContent(schemaRef('SetUserSectionRequest')) },
        responses: {
          200: userResponse('User section updated'),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('User not found'),
          409: errorResponse('Concurrent update conflict'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/auth/users/{userId}/status': {
      patch: {
        tags: ['User Management'],
        summary: 'Activate or deactivate a user',
        description: 'Deactivation revokes active refresh tokens. App managers cannot deactivate themselves or the last active app manager.',
        security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'userId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: { required: true, ...jsonContent(schemaRef('SetUserStatusRequest')) },
        responses: {
          200: userResponse('User status updated'),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('User not found'),
          409: errorResponse('Self-update, last-app-manager, or concurrent update conflict'),
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
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Account is inactive'),
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
          { in: 'query', name: 'isActive', schema: { type: 'string', enum: ['true', 'false'] } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in key and label.', schema: { type: 'string', maxLength: 100 } },
          ...listSortParameters(['key', 'label', 'order', 'isActive', 'updatedAt']),
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
          409: errorResponse('Menu key already exists'),
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
        security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateMenuRequest')) },
        responses: {
          200: response('Menu updated', schemaRef('MenuResponse')),
          400: errorResponse('Validation failed'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('Menu not found'),
          409: errorResponse('Menu key already exists'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['App Manager'],
        summary: 'Delete a menu',
        description: 'Deletes the menu and all its items (cascade).',
        security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Menu deleted', schemaRef('MenuResponse')),
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
        tags: ['App Manager'], summary: 'Delete a menu access', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuAccessId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Menu access deleted', schemaRef('MenuAccessResponse')),
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
          { in: 'query', name: 'search', description: 'Case-insensitive search in key, label, and path.', schema: { type: 'string', maxLength: 100 } },
          ...listSortParameters(['menuId', 'key', 'label', 'path', 'order', 'isActive', 'updatedAt']),
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
          409: errorResponse('Menu item key already exists'),
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
          404: errorResponse('Menu item not found'),
          409: errorResponse('Menu item key already exists'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['App Manager'],
        summary: 'Delete a menu item',
        security: protectedSecurity,
        parameters: [{ in: 'path', name: 'menuItemId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: response('Menu item deleted', schemaRef('MenuItemResponse')),
          400: errorResponse('Invalid menu item ID'),
          401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Active app manager role is required'),
          404: errorResponse('Menu item not found'),
          429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/items': {
      get: {
        tags: ['Marketing'], summary: 'List active item sizes', description: 'Each active size is returned as one row together with its item and service.', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'serviceName', description: 'Case-insensitive partial match on service name.', schema: { type: 'string', maxLength: 200 } },
          { in: 'query', name: 'itemName', description: 'Case-insensitive partial match on item name.', schema: { type: 'string', maxLength: 200 } },
          { in: 'query', name: 'size', description: 'Case-insensitive partial match on size.', schema: { type: 'string', maxLength: 100 } },
          ...listSortParameters(['serviceName', 'itemName', 'size']),
        ],
        responses: {
          200: { description: 'Items retrieved', ...jsonContent(schemaRef('ItemListResponse')) },
          400: errorResponse('Invalid query parameters'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      post: {
        tags: ['Marketing'], summary: 'Create an item', security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('CreateItemRequest')) },
        responses: {
          201: { description: 'Item created', ...jsonContent(schemaRef('ItemResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 409: errorResponse('Service is inactive or not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/items/{itemId}': {
      get: {
        tags: ['Marketing'], summary: 'Get an item', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'itemId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Item retrieved', ...jsonContent(schemaRef('ItemResponse')) },
          400: errorResponse('Invalid item ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Item not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['Marketing'], summary: 'Update an item', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'itemId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateItemRequest')) },
        responses: {
          200: { description: 'Item updated', ...jsonContent(schemaRef('ItemResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Item not found'),
          409: errorResponse('Service is inactive or not found'), 429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['Marketing'], summary: 'Deactivate an item', description: 'Deactivates the item and all of its sizes.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'itemId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Item deactivated', ...jsonContent(schemaRef('ItemResponse')) },
          400: errorResponse('Invalid item ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Item not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/companies': {
      get: {
        tags: ['Marketing'], summary: 'List companies', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in name, type, and address.', schema: { type: 'string', maxLength: 100 } },
          { in: 'query', name: 'hasContract', schema: { type: 'boolean' } },
          ...listSortParameters(['name', 'type', 'address', 'hasContract', 'version', 'updatedAt']),
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
        tags: ['Marketing'], summary: 'Create a new company version', description: 'Revokes the current company and active staff records, then creates a new company version and copies active staff with version 0.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'companyId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateCompanyRequest')) },
        responses: {
          200: { description: 'Company updated', ...jsonContent(schemaRef('CompanyResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company not found'),
          409: errorResponse('Normalized company or staff name already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['Marketing'], summary: 'Delete a company', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'companyId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Company deleted', ...jsonContent(schemaRef('CompanyResponse')) },
          400: errorResponse('Invalid company ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/company-staffs': {
      get: {
        tags: ['Marketing'], summary: 'List company staff', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'companyId', schema: { type: 'string', format: 'uuid' } },
          { in: 'query', name: 'search', description: 'Case-insensitive search in staff name, telephone, and email.', schema: { type: 'string', maxLength: 100 } },
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
        tags: ['Marketing'], summary: 'Update company staff', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'companyStaffId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateCompanyStaffRequest')) },
        responses: {
          200: { description: 'Company staff updated', ...jsonContent(schemaRef('CompanyStaffResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company or staff not found'),
          409: errorResponse('Normalized company staff name already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['Marketing'], summary: 'Revoke company staff', description: 'Sets revoked to true and increments the staff version instead of deleting the row.', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'companyStaffId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Company staff deleted', ...jsonContent(schemaRef('CompanyStaffResponse')) },
          400: errorResponse('Invalid staff ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Company staff not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services': {
      get: {
        tags: ['Marketing'], summary: 'List services', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'code', description: 'Case-insensitive partial match on code.', schema: { type: 'string', maxLength: 50 } },
          { in: 'query', name: 'name', description: 'Case-insensitive partial match on name.', schema: { type: 'string', maxLength: 200 } },
          { in: 'query', name: 'isActive', schema: { type: 'boolean' } },
          ...listSortParameters(['code', 'name', 'isActive']),
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
          403: errorResponse('Marketing access is required'), 409: errorResponse('Service code already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services/{serviceId}': {
      get: {
        tags: ['Marketing'], summary: 'Get a service', security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } },
          { in: 'query', name: 'itemPage', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'itemLimit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: { description: 'Service retrieved', ...jsonContent(schemaRef('ServiceResponse')) },
          400: errorResponse('Invalid service ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      patch: {
        tags: ['Marketing'], summary: 'Update a service', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('UpdateServiceRequest')) },
        responses: {
          200: { description: 'Service updated', ...jsonContent(schemaRef('ServiceResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'), 409: errorResponse('Service code already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      delete: {
        tags: ['Marketing'], summary: 'Delete a service', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Service deleted', ...jsonContent(schemaRef('ServiceResponse')) },
          400: errorResponse('Invalid service ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services/{serviceId}/scopes': {
      post: {
        tags: ['Marketing'], summary: 'Create a single service scope', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('CreateScopeRequest')) },
        responses: {
          201: { description: 'Service scope created', ...jsonContent(schemaRef('ServiceScopeResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service not found'),
          409: errorResponse('Service scope already exists'), 429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/services/{serviceId}/scopes/{scopeId}': {
      delete: {
        tags: ['Marketing'], summary: 'Soft delete a service scope', description: 'Sets revoked to true instead of deleting the row.', security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } },
          { in: 'path', name: 'scopeId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Service scope soft deleted', ...jsonContent(schemaRef('ServiceScopeResponse')) },
          400: errorResponse('Invalid ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Service scope not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/maintenances': {
      get: {
        tags: ['Marketing'], summary: 'List maintenances', security: protectedSecurity,
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { in: 'query', name: 'code', description: 'Case-insensitive partial match on code.', schema: { type: 'string', maxLength: 50 } },
          { in: 'query', name: 'name', description: 'Case-insensitive partial match on name.', schema: { type: 'string', maxLength: 200 } },
          { in: 'query', name: 'isActive', schema: { type: 'boolean' } },
          ...listSortParameters(['code', 'name', 'isActive']),
        ],
        responses: {
          200: { description: 'Maintenances retrieved', ...jsonContent(schemaRef('MaintenanceListResponse')) },
          400: errorResponse('Invalid query parameters'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
      post: {
        tags: ['Marketing'], summary: 'Create a maintenance', security: protectedSecurity,
        requestBody: { required: true, ...jsonContent(schemaRef('CreateMaintenanceRequest')) },
        responses: {
          201: { description: 'Maintenance created', ...jsonContent(schemaRef('MaintenanceResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 409: errorResponse('Maintenance code already exists'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/maintenances/{maintenanceId}': {
      get: {
        tags: ['Marketing'], summary: 'Get a maintenance', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'maintenanceId', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Maintenance retrieved', ...jsonContent(schemaRef('MaintenanceResponse')) },
          400: errorResponse('Invalid maintenance ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Maintenance not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/maintenances/{maintenanceId}/scopes': {
      post: {
        tags: ['Marketing'], summary: 'Create a single maintenance scope', security: protectedSecurity,
        parameters: [{ in: 'path', name: 'maintenanceId', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, ...jsonContent(schemaRef('CreateScopeRequest')) },
        responses: {
          201: { description: 'Maintenance scope created', ...jsonContent(schemaRef('MaintenanceScopeResponse')) },
          400: errorResponse('Validation failed'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Maintenance not found'),
          409: errorResponse('Maintenance scope already exists'), 429: errorResponse('Rate limit exceeded'),
          500: errorResponse('Internal server error'),
        },
      },
    },
    '/api/v1/marketing/maintenances/{maintenanceId}/scopes/{scopeId}': {
      delete: {
        tags: ['Marketing'], summary: 'Soft delete a maintenance scope', description: 'Sets revoked to true instead of deleting the row.', security: protectedSecurity,
        parameters: [
          { in: 'path', name: 'maintenanceId', required: true, schema: { type: 'string', format: 'uuid' } },
          { in: 'path', name: 'scopeId', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Maintenance scope soft deleted', ...jsonContent(schemaRef('MaintenanceScopeResponse')) },
          400: errorResponse('Invalid ID'), 401: errorResponse('Missing or invalid access token'),
          403: errorResponse('Marketing access is required'), 404: errorResponse('Maintenance scope not found'),
          429: errorResponse('Rate limit exceeded'), 500: errorResponse('Internal server error'),
        },
      },
    },
  },
};

// Standalone maintenance routes were removed; maintenance is managed via services.
for (const path of Object.keys(openApiDocument.paths)) {
  if (path.startsWith('/api/v1/marketing/maintenances')) {
    delete (openApiDocument.paths as Record<string, unknown>)[path];
  }
}
delete (openApiDocument.paths['/api/v1/marketing/services/{serviceId}'] as Record<string, unknown>).patch;
(openApiDocument.paths as Record<string, unknown>)['/api/v1/marketing/services/{serviceId}/maintenance/scopes'] = {
  post: {
    tags: ['Marketing'], summary: 'Create a maintenance scope for a service', security: protectedSecurity,
    parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: { required: true, ...jsonContent(schemaRef('CreateScopeRequest')) },
    responses: {
      201: { description: 'Maintenance scope created', ...jsonContent(schemaRef('MaintenanceScopeResponse')) },
      400: errorResponse('Validation failed'), 404: errorResponse('Service not found'), 409: errorResponse('Service does not provide maintenance'),
    },
  },
};
(openApiDocument.paths as Record<string, unknown>)['/api/v1/marketing/services/{serviceId}/maintenance'] = {
  post: {
    tags: ['Marketing'], summary: 'Create maintenance for a service', security: protectedSecurity,
    parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } }],
    requestBody: { required: true, ...jsonContent(schemaRef('CreateMaintenanceRequest')) },
    responses: { 201: { description: 'Maintenance created', ...jsonContent(schemaRef('MaintenanceResponse')) }, 404: errorResponse('Service not found'), 409: errorResponse('Service already has maintenance') },
  },
};
(openApiDocument.paths as Record<string, unknown>)['/api/v1/marketing/services/{serviceId}/maintenance/scopes/{scopeId}'] = {
  delete: {
    tags: ['Marketing'], summary: 'Soft delete a maintenance scope for a service', security: protectedSecurity,
    parameters: [
      { in: 'path', name: 'serviceId', required: true, schema: { type: 'string', format: 'uuid' } },
      { in: 'path', name: 'scopeId', required: true, schema: { type: 'string', format: 'uuid' } },
    ],
    responses: {
      200: { description: 'Maintenance scope soft deleted', ...jsonContent(schemaRef('MaintenanceScopeResponse')) },
      400: errorResponse('Invalid ID'), 404: errorResponse('Service or maintenance scope not found'),
      409: errorResponse('Service does not provide maintenance'),
    },
  },
};
