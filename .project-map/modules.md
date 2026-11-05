# Module Index

> Maintain only high-value module boundaries and entry points.
> Update a section when that area changes; do not regenerate the whole index.

| Module / path | Responsibility | Key entry points | Important dependencies |
|---|---|---|---|
| `api-gateway/src` | Public edge: routing table, reverse proxy, JWT guard, rate limiting, Swagger | `src/server.ts`, `src/app.ts`, `src/routes/proxy.routes.ts`, `src/config/services.config.ts`, `src/config/env.ts` | express, http-proxy-middleware, jose, zod, winston, swagger-ui-express |
| `app-manager-service/src/modules/menu` | Menus (6), menu items (5), menu access (5) routes | `src/routes/index.ts` -> `src/modules/menu/menus/menu.routes.ts`, `menu-items/menu-item.routes.ts`, `menu-accesses/menu-access.routes.ts` | Prisma (`src/config/db.ts`), gateway/auth middlewares |
| `app-manager-service/src/modules/reference/office-branch` | Office-branch reference data (5 routes) and the only declaration of `office_branches` | `src/modules/reference/office-branch/office-branch.routes.ts` | Prisma on `akura_auth`, gateway/auth middlewares |
| `auth-service/src/modules/auth` | Login, refresh, logout, profile, password; key material and JWKS | `src/modules/auth/auth.routes.ts` (7 routes), `src/config/accessKey.ts`, `src/app.ts` (`/.well-known/jwks.json`) | Prisma, jose/RS256, bcryptjs, cookie handling (`src/utils/cookies.ts`) |
| `auth-service/src/modules/user-management` | User CRUD (6 routes), marketing contact directory, inspector lookup, sync delivery inspector | `src/modules/user-management/user-management.routes.ts` | Prisma, `authenticate`, `requireAppManager`, user mapper/history utils |
| `auth-service/src/modules/user-sync` | Outbound user snapshot/event delivery with retry | `src/modules/user-sync/user-sync.delivery.ts`, `user-sync.service.ts`, `user-sync.repository.ts` | fetch to API Gateway, `x-user-sync-secret`, Prisma advisory locks |
| `fieldservice-service/src/modules/work-orders` | Work Order lifecycle and numbering (8 routes); snapshots Marketing data into `jsonb` | `src/routes/index.ts` -> `src/modules/work-orders/work-order.routes.ts`, `work-order.repository.ts` | Prisma, `src/integrations/gateway.ts` |
| `fieldservice-service/src/modules/options` | Field service option/master data (3 routes) | `src/modules/options/option.routes.ts` | Prisma, gateway/auth middlewares |
| `fieldservice-service/src/modules/user-sync` | Inbound user-sync event receiver (1 POST) | `src/modules/user-sync/user-sync.routes.ts` | gateway-secret guard, `x-user-sync-secret`, Prisma advisory locks |
| `fieldservice-service/src/integrations` | Outbound gateway client, strict allowlist projection of Marketing payloads | `src/integrations/gateway.ts` (`gatewayGet`, `toQuotationSnapshot`, `toContractSnapshot`, work-order callback) | fetch, zod, `WORK_ORDER_SYNC_SECRET` |
| `finance-service/src/modules/taxes` | Tax master data (4 routes) and outbound tax event delivery | `src/modules/taxes/tax.routes.ts`, `tax-delivery.ts`, `tax.repository.ts` | Prisma on `akura_finance`, fetch to API Gateway, `TAX_SYNC_SECRET` |
| `marketing-service/src/modules/quotations` | Quotation references and Work Order link state (14 + 1 routes) | `src/modules/quotations/quotation.routes.ts`, `work-order.integration.ts`, `work-order-events.routes.ts`, `quotation-pdf.ts` | Prisma, `fetch` to Field Service via gateway, `WORK_ORDER_SYNC_SECRET`, pdfkit |
| `marketing-service/src/modules/contracts` | Contracts with lifecycle transitions (12 routes) and Excel export | `src/modules/contracts/contract.routes.ts`, `contract-excel.controller.ts`, `contract-excel.workbook.ts` | Prisma, exceljs, multer (file upload) |
| `marketing-service/src/modules/contract-prices` | Contract pricing and price history (2 routes) | `src/modules/contract-prices/contract-price-history.routes.ts` | Prisma |
| `marketing-service/src/modules/items` | Item master, item size, scopes, price history (21 routes) | `src/modules/items/item.routes.ts`, `item-price.controller.ts` | Prisma, zod |
| `marketing-service/src/modules/services` | Service master with inspection/maintenance scopes (10 routes) | `src/modules/services/service.routes.ts` | Prisma |
| `marketing-service/src/modules/companies` | Company master data (6 routes) | `src/modules/companies/company.routes.ts` | Prisma |
| `marketing-service/src/modules/company-staff` | Company staff assignment (6 routes) | `src/modules/company-staff/company-staff.routes.ts` | Prisma |
| `marketing-service/src/modules/taxes` | Tax read model (`TaxCache`) and inbound tax event receiver (1 POST) | `src/modules/taxes/tax-events.routes.ts`, `tax-sync.ts` | Prisma, gateway-secret guard, `x-tax-sync-secret` |
| `marketing-service/src/modules/user-sync` | Inbound user-sync event receiver (1 POST) | `src/modules/user-sync/user-sync-events.routes.ts` | Prisma, gateway-secret guard, `x-user-sync-secret` |
| `marketing-service/src/routes/index.ts` | Quotation/contract/company/item-size reference endpoints plus router mounting (5 routes) | `src/routes/index.ts` -> `companies`, `company-staffs`, `services`, `items`, `company-contracts`, `company-contract-prices`, `quotations` | Prisma, `requireMarketingAccess`, `requireQuotationReferenceAccess` |
| `*/src/config/db.ts` (5 domain services) | Prisma client lifecycle per service | `connectDb` / `disconnectDb` | **PostgreSQL** for all five; data maps in `architecture.md` |
| `*/prisma/schema.prisma` (5 domain services) | Per-service data model | n/a | Prisma CLI (`db:generate`, `db:push`); every service is `provider = "postgresql"` |
| `src/middlewares/gateway.middleware.ts` (all domain services) | Verifies the gateway secret on inbound traffic | `verifyGatewaySecret` | distinct per-service `GATEWAY_SECRET` |
| `src/middlewares/auth.middleware.ts` (all domain services) | Verifies the RS256 access token locally (`type === 'access'`) | `authenticate` | JWKS of auth-service via gateway |
| `src/middlewares/authorize.middleware.ts` / `actor.middleware.ts` | Cross-checks gateway headers and token against the live `auth/me` profile; sets `authUser`/`documentActor` | `requireMarketingAccess`, `requireQuotationReferenceAccess`, `requireActor`, `requireAppManager`, `requireWorkOrderSection` | fetch to gateway, section/role policy, branch refresh check |
| `src/middlewares/error.middleware.ts` (all domain services) | Collapse thrown errors into the standard JSON body | `errorHandler` | winston |
| `src/utils/serviceUrl.ts` (all six services) | Builds downstream URLs and service headers for gateway-mediated calls | `serviceUrl`, `serviceHeaders` | `API_GATEWAY_URL`, per-service prefix allowlist |
| `api-gateway/src/docs/openapi.ts` | The single Swagger source of truth served at `/api-docs` | `openApiDocument`, `src/config/swagger.config.ts` | swagger-ui-express |
| UNKNOWN | Modules not yet mapped: item/contract price controller internals, quotation PDF generation (`pdfkit`), auth refresh-token rotation policy | UNKNOWN | UNKNOWN |

### CONFIRMED notes for this index
- Swagger has 43 documented OpenAPI paths / 63 operations; Marketing, Finance and Field Service coverage is incomplete.
- Prior route-definition totals conflict (123 vs. 129); **exact route counts and count-based Swagger coverage are UNKNOWN** pending reconciliation. See `api-endpoints.md` for the previously collected route inventory and caveat.
- Middleware mount order is uniform across domain services: `helmet` -> `verifyGatewaySecret` -> `cors` -> `requestIdMiddleware` -> `cookieParser` -> body parsers -> *internal event routers* (unauthenticated, they use sync secrets) -> `/health` -> `authenticate` -> routes -> 404 -> `errorHandler`. Example: `marketing-service/src/app.ts`, `fieldservice-service/src/app.ts`.
- auth-service is the exception: it has no `src/routes/index.ts` and no global `authenticate` in `src/app.ts`; protection is per route or per router inside `auth.routes.ts` / `user-management.routes.ts`.
- No `*.test.*` / `*.spec.*` files and no `test` script exist; the only validation commands are `npm run typecheck` and `npm run build`.