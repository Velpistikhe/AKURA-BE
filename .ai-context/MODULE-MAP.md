# Module map

> Scope: top-level services and their feature modules. Not a file inventory.

## Services (top-level directories, each an independent npm package)

| Service | Responsibility | Entry points | Depends on |
|---|---|---|---|
| `api-gateway` | Reverse proxy, JWT verification, rate limiting, OpenAPI docs | `src/server.ts`, `src/app.ts`, `src/routes/proxy.routes.ts` | All 5 domain services (HTTP); Auth JWKS |
| `auth-service` | Auth (register/login/refresh/logout), user management, JWKS endpoint, user-sync event producer | `src/server.ts`, `src/app.ts`, `src/modules/auth/auth.routes.ts` | PostgreSQL via Prisma; `keys/` for RS256 |
| `app-manager-service` | Menus, menu items, menu accesses, office-branch reference data | `src/server.ts`, `src/app.ts`, `src/routes/index.ts` | PostgreSQL via Prisma; `akura_auth` DB |
| `marketing-service` | Companies, company staff, contracts, contract prices, items/services, quotations (PDF/Excel) | `src/server.ts`, `src/app.ts`, `src/routes/index.ts` | PostgreSQL via Prisma; S3-compatible storage; consumes tax/user/work-order events |
| `finance-service` | Tax master data, tax-delivery event producer | `src/server.ts`, `src/app.ts`, `src/routes/index.ts` | PostgreSQL via Prisma; gateway for profile reads |
| `fieldservice-service` | Work orders, options, user-sync consumer | `src/server.ts`, `src/app.ts`, `src/routes/index.ts` | PostgreSQL via Prisma; gateway for profile reads; consumes user-sync events |

## api-gateway internals

| Area | Responsibility | Key paths |
|---|---|---|
| Route registration | Builds one proxy route per service entry | `src/routes/proxy.routes.ts`, `src/config/services.config.ts` |
| Auth | JWT verification → `X-User-*` headers | `src/middlewares/auth.middleware.ts` |
| Service identity | `x-service-name` / `x-service-secret` check | `src/middlewares/serviceCaller.middleware.ts` |
| Infra middleware | request id, logger, rate limiter, error handler | `src/middlewares/{requestId,logger,rateLimiter,error}.middleware.ts` |
| OpenAPI docs | Hand-written spec per module domain | `src/docs/{openapi,catalog,quotation,tax,user-sync,work-orders,operational-documents,module-tags}.ts` |

## Domain service feature modules (`src/modules/<feature>/`)

### auth-service
| Module | Responsibility | Key paths |
|---|---|---|
| `auth` | Register/login/refresh/logout, profile, password change | `modules/auth/auth.{routes,controller,service,repository,schemas}.ts`, `auth.middleware.ts` |
| `user-management` | User listing/admin, history, list/sort config | `modules/user-management/user-management.*.ts`, `config/list.config.ts` |
| `user-sync` | Outbox producer + delivery worker for user events | `modules/user-sync/user-sync.{service,delivery}.ts` |

### app-manager-service
| Module | Responsibility | Key paths |
|---|---|---|
| `menu` | Menus, menu items, menu accesses (nested sub-features) | `modules/menu/{menus,menu-items,menu-accesses}/*` |
| `reference` | Office-branch reference data | `modules/reference/office-branch/*` |

### marketing-service
| Module | Responsibility | Key paths |
|---|---|---|
| `companies` | Company master data + history | `modules/companies/company.*.ts` |
| `company-staff` | Staff linked to companies | `modules/company-staff/company-staff.*.ts` |
| `contracts` | Company contracts + Excel import/export | `modules/contracts/contract*.ts` |
| `contract-prices` | Contract price history | `modules/contract-prices/contract-price-history.*.ts` |
| `items` | Items, item sizes, item prices, history | `modules/items/item*.ts`, `quotation-price.ts` |
| `services` | Service catalog | `modules/services/service.*.ts` |
| `quotations` | Quotation lifecycle, PDF, storage, work-order integration | `modules/quotations/*` |
| `taxes` | Tax event consumer | `modules/taxes/{tax-events.routes,tax-sync}.ts` |
| `user-sync` | User event consumer + contact projection | `modules/user-sync/*` |

### finance-service
| Module | Responsibility | Key paths |
|---|---|---|
| `taxes` | Tax CRUD, delivery outbox, snapshot/resync | `modules/taxes/{tax.routes,tax.repository,tax.schemas,tax-delivery}.ts` |

### fieldservice-service
| Module | Responsibility | Key paths |
|---|---|---|
| `work-orders` | Work order CRUD + numbering | `modules/work-orders/{work-order.routes,work-order.repository,work-order.schemas,work-order-number}.ts` |
| `options` | Field-service option/reference endpoints | `modules/options/option.routes.ts` |
| `user-sync` | User event consumer | `modules/user-sync/{user-sync.routes,user-sync.repository}.ts` |

## Shared cross-service directories (duplicated per service, not a shared package)

| Area | Purpose | Key paths |
|---|---|---|
| `src/config` | Env validation, Prisma client, list config, JWKS key | `config/{env,db,list.config,accessKey}.ts` |
| `src/middlewares` | auth, gateway secret, actor/authorize, validate, requestId, error | `middlewares/*.ts` |
| `src/utils` | `asyncHandler`, `HttpError`, logger, token helpers, `officeBranch`, `requestTokens` | `utils/*.ts` |
| `src/integrations` | Outbound HTTP to the gateway | `integrations/gateway.ts` (finance, fieldservice only) |
| `src/types` | Shared TS types | `types/auth.types.ts` |

## Navigation notes
- Route mounting is the fastest way to find a handler: start at `<service>/src/routes/index.ts`, then the module's `*.routes.ts`.
- `api-gateway` has no `src/modules/` — its "modules" live in `src/docs/` (OpenAPI) and `src/config/services.config.ts` (routing).
- `auth-service` is the only service without `src/routes/`; routers are mounted directly in `src/app.ts`.
- The frontend is **not** in this repo — "marketing", "finance", "fieldservice" refer to backend services here.
- Update only when module responsibilities or boundaries materially change.

