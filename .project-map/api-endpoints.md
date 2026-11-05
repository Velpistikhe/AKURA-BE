# API Endpoints

> Route inventory copied from the completed exploration pass; counts are **not recomputed here**.
> Counts reflect `router.<method>(` occurrences across service `src/**/*.ts`, including multiline calls and routes declared in `marketing-service/src/routes/index.ts`.
> Relative route paths below are mounted under the prefix shown. Parameter notation follows Express (`:id`).

## Public gateway endpoints

Gateway self-service (`api-gateway/src/app.ts`):

| Method | Path | Middleware / behavior |
|---|---|---|
| GET | `/health` | gateway stack |
| GET | `/services` | gateway stack; exposes configured routes, authRequired and descriptions |
| GET | `/api-docs` | Swagger UI |
| GET | `/api-docs.json` | OpenAPI JSON |

Gateway proxy prefixes (`api-gateway/src/config/services.config.ts`):

| Prefix | Target | Authentication |
|---|---|---|
| `/api/v1/auth` | auth-service | No gateway JWT; endpoint/router enforces auth as needed |
| `/api/v1/app-manager` | app-manager-service | JWT required |
| `/api/v1/marketing` | marketing-service | JWT required |
| `/api/v1/finance` | finance-service | JWT required; route exists only when URL + secret are configured |
| `/api/v1/fieldservice` | fieldservice-service | JWT required; route exists only when URL + secret are configured |
| `/api/v1/marketing/internal/users/events` | marketing-service | internal caller `auth-service`, POST only, no JWT |
| `/api/v1/marketing/internal/taxes/events` | marketing-service | internal caller `finance-service`, POST only, no JWT |
| `/api/v1/marketing/internal/work-orders/events` | marketing-service | internal caller `fieldservice-service`, POST only, no JWT |
| `/api/v1/fieldservice/internal/users/events` | fieldservice-service | internal caller `auth-service`, POST only, only when fieldservice is configured |

Gateway common middleware order (`api-gateway/src/app.ts`): helmet → CORS/preflight → request ID → logger → cookie parser → `authenticateServiceCaller` → global rate limiter → docs/self-service → proxy. `globalRateLimiter` skips verified service callers. Proxy strips inbound identity headers; it verifies JWT for routes with `authRequired: true` before forwarding identity.

## auth-service — 13 route definitions

Mount: `/api/v1/auth` at the gateway. `auth-service/src/app.ts` mounts `authRoutes` at `/`, user routes at `/users`, JWKS at `/.well-known/jwks.json`, and `/health`.

| Method | Path | Middleware / notes |
|---|---|---|
| POST | `/register` | validate body; no user auth |
| POST | `/login` | validate body; no user auth |
| POST | `/refresh-token` | no user auth; refresh-token cookie/body flow |
| POST | `/logout` | no user auth |
| GET | `/me` | `authenticate` |
| PUT | `/profile` | `authenticate`, validate body |
| PUT | `/password` | `authenticate`, validate body |
| GET | `/users/marketing-contacts` | `authenticate`; branch derived from caller |
| GET | `/users/field-service/inspectors` | `authenticate`; query validated; branch scoped |
| GET | `/users` | `authenticate` + `requireAppManager` |
| GET | `/users/sync/deliveries` | `authenticate` + `requireAppManager` |
| GET | `/users/:userId` | `authenticate` + `requireAppManager` |
| PATCH | `/users/:userId` | `authenticate` + `requireAppManager` |
| service | GET `/health`, GET `/.well-known/jwks.json` | app-level handlers; JWKS cache max-age 300s |

Middleware order (`auth-service/src/app.ts`): helmet → `verifyGatewaySecret` → CORS → request ID → cookie parser → body parsers → `/health` + JWKS → user routes → auth routes → 404 → error handler. Auth is per-route/per-router; there is no global `authenticate`.

## app-manager-service — 21 route definitions

Mount: `/api/v1/app-manager`. Router registration in `app-manager-service/src/routes/index.ts`.

| Relative mount | Methods and paths |
|---|---|
| `/menus` | GET `/`, GET `/:menuId`, POST `/`, PATCH `/:menuId`, DELETE `/:menuId`; GET `/my-menus` |
| `/menu-items` | GET `/`, GET `/:menuItemId`, POST `/`, PATCH `/:menuItemId`, DELETE `/:menuItemId` |
| `/menu-accesses` | GET `/`, GET `/:menuAccessId`, POST `/`, PATCH `/:menuAccessId`, DELETE `/:menuAccessId` |
| `/office-branches` | GET `/`, GET `/options`, GET `/:officeBranchId`, POST `/`, PATCH `/:officeBranchId` |
| service | GET `/health` |

Note: the prior project index reports 21 app-manager route definitions, but the grouped inventory above lists 20 router handlers plus `/health`; this discrepancy is **UNKNOWN** and is not reconciled here.

Middleware order (`app-manager-service/src/app.ts`): helmet → gateway-secret verification → CORS → request ID → cookie parser → body parsers → `/health` → `authenticate` → routes → 404 → error handler. `authorize` calls `auth/me` and checks live role/section; branch-scoped operations derive branch from authenticated profile.

## fieldservice-service — 12 route definitions

Mount: `/api/v1/fieldservice`. `src/routes/index.ts` mounts `/work-orders` and `/options`; internal user sync mounts before authentication.

| Relative mount | Methods and paths |
|---|---|
| `/options` | GET `/inspectors`, GET `/quotations/:quotationId`, GET `/quotations` |
| `/work-orders` | GET `/by-quotation/:quotationId`, GET `/`, GET `/:id/history`, GET `/:id`, POST `/`, POST `/:id/start`, PATCH `/:id`, DELETE `/:id` |
| service root | POST `/internal/users/events` (dedicated `x-user-sync-secret`; no JWT) |
| service | GET `/health` |

**Count note:** 12 `router.<method>` definitions are split between work-orders (8), options (3), and user-sync (1). `/health` is an app-level handler and not included in that 12.

Middleware order (`fieldservice-service/src/app.ts`): helmet → gateway-secret verification → CORS → request ID → cookie parser → body parsers → inbound user-sync route → `/health` → `authenticate` → routes (also mounted at `/fieldservice` for direct development) → 404 → error handler. Work-order routes use `requireActor`/`requireWorkOrderReferenceActor` and `requireWorkOrderSection`.

## finance-service — 4 route definitions

Mount: `/api/v1/finance`; router mounted at `/` and `/finance` in local direct-development mode.

| Relative mount | Methods and paths |
|---|---|
| `/taxes` | GET `/`, GET `/deliveries`, POST `/`, POST `/resync` |
| service | GET `/health` |

`tax.routes.ts` first applies `requireActor`; writes additionally require `ADMIN` and `FINANCE` or `MARKETING`. Every tax read/write is branch scoped. Middleware order follows domain-service pattern: gateway guard → CORS/request ID/body parsers → `/health` → `authenticate` → routes → 404 → error handler.

## marketing-service — 79 route definitions

Mount: `/api/v1/marketing`. `src/routes/index.ts` mounts subrouters after five reference endpoints and `requireMarketingAccess`. Internal event routers mount before JWT authentication.

| Relative mount | Methods and paths |
|---|---|
| `/companies` | GET `/`, GET `/:companyId`, GET `/:companyId/history`, POST `/`, PATCH `/:companyId`, GET `/:companyId/staff-history` |
| `/company-staffs` | GET `/`, GET `/:companyStaffId`, GET `/:companyStaffId/history`, POST `/`, PATCH `/:companyStaffId`, DELETE `/:companyStaffId` |
| `/services` | GET `/`, GET `/:serviceId`, GET `/:serviceId/history`, POST `/`, PATCH `/:serviceId`, DELETE `/:serviceId`, POST `/:serviceId/inspection/scopes`, DELETE `/:serviceId/inspection/scopes/:inspectionScopeId`, POST `/:serviceId/maintenance/scopes`, DELETE `/:serviceId/maintenance/scopes/:scopeId` |
| `/items` | GET `/`, GET `/sizes`, GET `/sizes/contract-price-options/:contractId`, GET `/sizes/export`, GET `/sizes/prices`, GET `/sizes/:itemSizeId`, GET `/sizes/:itemSizeId/history`, GET `/sizes/:itemSizeId/price/history`, POST `/sizes`, POST `/sizes/:itemSizeId/price`, POST `/sizes/:itemSizeId/contract-prices`, PATCH `/sizes/:itemSizeId/price`, DELETE `/sizes/:itemSizeId`, GET `/:itemId`, POST `/:itemId/scopes`, GET `/:itemId/history`, PATCH `/:itemId`, DELETE `/:itemId`, PATCH `/contract-prices/:contractPriceId`, DELETE `/contract-prices/:contractPriceId` |
| `/company-contracts` | GET `/`, GET `/:contractId`, GET `/:contractId/history`, POST `/`, PATCH `/:contractId`, DELETE `/:contractId`, POST `/:contractId/submit`, POST `/:contractId/reject`, POST `/:contractId/approve`, POST `/:contractId/revise`, POST `/:contractId/terminate`, POST `/:contractId/prices/import` |
| `/company-contract-prices` | GET `/`, GET `/:contractPriceId/history` |
| `/quotations` | GET `/`, GET `/:quotationId`, GET `/:quotationId/pdf`, GET `/:quotationId/history`, POST `/`, POST `/:quotationId/approve`, POST `/:quotationId/submit`, POST `/:quotationId/reject`, POST `/:quotationId/revise`, POST `/:quotationId/items`, DELETE `/:quotationId/items/:itemId`, POST `/:quotationId/work-orders`, PATCH `/:quotationId`, DELETE `/:quotationId` |
| `/` (reference endpoints) | GET `/company-contract-references/:companyId`, GET `/quotation-references`, GET `/quotation-references/:quotationId`, GET `/item-size-references/:itemSizeId`, GET `/contract-references/:contractId` |
| `/internal/users/events` | POST (dedicated `x-user-sync-secret`; no JWT) |
| `/internal/taxes/events` | POST (dedicated `x-tax-sync-secret`; no JWT) |
| `/internal/work-orders/events` | POST (dedicated `x-work-order-sync-secret`; no JWT) |
| service | GET `/health` |

**Middleware order (`marketing-service/src/app.ts`):** helmet → gateway-secret verification → CORS → request ID → cookie parser → body parsers → tax/user/work-order event routes → `/health` → `authenticate` → reference handlers / `requireMarketingAccess` → mounted business routers → 404 → error handler. Reference routes use `requireQuotationReferenceAccess`; business routes use `requireMarketingAccess`; each validates params/body and scopes data to `officeBranchId`.

## Swagger coverage

Source: `api-gateway/src/docs/openapi.ts`, served through `api-gateway/src/config/swagger.config.ts`.

Verified totals from prior exploration (not recalculated): **43 OpenAPI paths, 63 operations**. Prefix distribution:

| Prefix | Documented paths |
|---|---:|
| `/api/v1/auth` | 14 |
| `/api/v1/app-manager` | 11 |
| `/api/v1/marketing` | 12 |
| `/api/v1/finance` | 1 |
| `/api/v1/fieldservice` | 1 |
| Gateway self-service | 4 |

The route count and OpenAPI path count are different measures. Among documented paths, `/health` accounts for service health endpoints. Known coverage gap: Marketing item, contract, quotation, price-history and reference routes are mostly absent; Finance and Field Service have health-only docs.

## Count caveat / UNKNOWN

The exploration pass reported **123** route definitions in one report and **129** in a later report. A later grep found different totals depending on whether it searched only `*.routes.ts` or all `src/**/*.ts`, and the path/method totals were also inconsistent. Per the instruction not to repeat the route analysis, this document does not resolve those discrepancies. Use the service/grouped endpoint list as a navigation aid, not a complete machine-verified inventory. The Swagger totals (43 paths / 63 operations) are from the prior verified pass; do not derive a route-to-Swagger coverage ratio from the conflicting route counts. Reconcile via a scoped route-registration inventory before treating exact totals as authoritative.
