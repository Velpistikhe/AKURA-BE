# Architecture

## Topology

```
Client (browser/frontend, not in this repo)
        │  Bearer JWT / accessToken cookie
        ▼
  api-gateway  :5000  ── JWT verify (RS256 via Auth JWKS) ──► injects X-User-* headers
        │  http-proxy-middleware, prefix rewrite, x-gateway-secret
        ├─► /api/v1/auth            → auth-service         :5001  (authRequired: false)
        ├─► /api/v1/app-manager     → app-manager-service  :5002  (authRequired: true)
        ├─► /api/v1/marketing       → marketing-service    :5003  (authRequired: true)
        ├─► /api/v1/finance         → finance-service      :5004  (authRequired: true, conditional on env)
        └─► /api/v1/fieldservice    → fieldservice-service :5005  (authRequired: true, conditional on env)
```

Evidence: `api-gateway/src/config/services.config.ts`, `api-gateway/.env.example`.

Each domain service is a standalone Express 4 app + its own PostgreSQL database via Prisma. There is **no shared runtime, no shared package, and no root manifest** — services communicate only over HTTP through the gateway.

## Startup

- Entry point per service: `<service>/src/server.ts` → imports `<service>/src/app.ts`.
- `src/app.ts` builds the Express app and exports it (default export). `src/server.ts` does `app.listen(env.PORT, ...)` and registers `SIGTERM`/`SIGINT` graceful shutdown with a 10s force-exit timer.
- Domain services connect Prisma **before** listening: `await connectDb()` in `startServer()` (`finance-service/src/server.ts`, `app-manager-service/src/server.ts`).
- `finance-service` additionally starts a background producer: `startTaxDelivery()` (`finance-service/src/modules/taxes/tax-delivery.ts`).
- Gateway has no DB and no `connectDb`.
- Evidence: `api-gateway/src/{app,server}.ts`, `finance-service/src/{app,server}.ts`, `app-manager-service/src/server.ts`.

## Request lifecycle

### Gateway (`api-gateway/src/app.ts`)
Order matters:
1. `helmet()`
2. `cors(corsOptions)` + `app.options('*', cors(...))` — origin allowlist from `env.CORS_ORIGIN`, with a dev-only local-origin allowance
3. `trust proxy = 1` **only** when `process.env.VERCEL === '1'`
4. `requestIdMiddleware`
5. `loggerMiddleware`
6. `cookieParser()`
7. `authenticateServiceCaller` — validates `x-service-name` + `x-service-secret` via `timingSafeEqual`; sets `res.locals.serviceCaller`
8. `globalRateLimiter` (`express-rate-limit`)
9. `/api-docs` (swagger-ui), `/api-docs.json`, `/health`, `/services`
10. `proxyRoutes` — one `router.use(prefix, ...middlewares)` per entry in `servicesConfig`
11. 404 JSON handler → `errorHandler`

### Proxy route (`api-gateway/src/routes/proxy.routes.ts`)
For each service entry:
- if `internalCaller` set → middleware requires `POST` **and** `res.locals.serviceCaller === service.internalCaller`, else 403
- if `authRequired` → `authenticateJwt` (`api-gateway/src/middlewares/auth.middleware.ts`): verifies the access token, then writes `x-user-id`, `x-user-role`, `x-user-name`, `x-user-username`, `x-office-branch-id` request headers
- then `http-proxy-middleware` `createProxyMiddleware` with `pathRewrite` from the config
- on `proxyReq`: sets `x-gateway-secret`, strips inbound `x-vercel-id` and all inbound `X-User-*` / `X-Office-Branch-ID` / `X-Service-*` headers (prevents header spoofing), then re-injects the authenticated `X-User-*` values
- proxy errors → 503 JSON
- `http-proxy-middleware` v4 is ESM-only, so it is loaded through dynamic `import()` and the resulting promise is cached across requests.

### Domain service (`<service>/src/app.ts`)
Typical order:
1. `helmet()`
2. `verifyGatewaySecret` — requires `x-gateway-secret === env.GATEWAY_SECRET`, else 403
3. `cors(...)`
4. `requestIdMiddleware`
5. `cookieParser()`, `express.json()`, `express.urlencoded({ extended: true })`
6. internal event routes mounted **before** `authenticate` (e.g. `marketing-service/src/app.ts` mounts `taxEvents`, `userSyncEvents`, `workOrderEvents`; `fieldservice-service/src/app.ts` mounts `userSyncEvents`)
7. `/health`
8. `authenticate` — verifies the access token, sets `req.user`
9. `routes` (the service router) — also mounted a second time under the gateway-style prefix (e.g. `/finance`, `/marketing`, `/fieldservice`) so local microfrontends can call the service directly in dev
10. 404 JSON handler → `errorHandler`

**Exception:** `auth-service` has no `src/routes/` dir and no app-level `authenticate` — it mounts `userManagementRoutes` at `/users` and `authRoutes` at `/` (`auth-service/src/app.ts`); `auth.routes.ts` applies `authenticate` per-route after the public auth routes.

## Layering inside a domain service

```
src/app.ts            → middleware composition, health, 404
src/server.ts         → DB connect, background workers, listen, shutdown
src/routes/index.ts   → router composition, mounts module routers, top-level access guards
src/modules/<name>/  → feature module:
    <name>.routes.ts       → route definitions, validate() + asyncHandler()
    <name>.controller.ts   → request/response shaping, orchestration
    <name>.service.ts      → business logic, transactions
    <name>.repository.ts   → Prisma data access
    <name>.schemas.ts      → Zod schemas for validation
src/middlewares/      → auth, gateway secret, actor, authorize, validate, requestId, error
src/config/           → env (Zod-validated), db (PrismaClient), list.config, accessKey
src/utils/            → asyncHandler, httpError, logger, tokens, errorDetails
src/integrations/     → outbound HTTP to the gateway (finance, fieldservice only)
src/types/            → shared TS types
```

Not every module has all files:
- `finance-service/src/modules/taxes/` — `tax.routes.ts`, `tax.repository.ts`, `tax.schemas.ts`, `tax-delivery.ts`; **no controller, no service**; the route handler calls `prisma`/`taxRepository` directly.
- `app-manager-service/src/modules/menu/` — nested feature folders `menus/`, `menu-items/`, `menu-accesses/`, each with the full controller/service/repository/routes/schemas/types set.
- `auth-service/src/modules/auth/` — full set plus `auth.middleware.ts`.
- `marketing-service/src/modules/quotations/` — routes + controller + repository + schemas + PDF/storage helpers; **no `.service.ts`** for the main flow.

Evidence: `marketing-service/src/routes/index.ts`, `finance-service/src/routes/index.ts`, `app-manager-service/src/routes/index.ts`, `auth-service/src/modules/auth/auth.routes.ts`, `marketing-service/src/modules/companies/company.routes.ts`.

## Validation
- Zod via a `validate(source, schema)` middleware → writes parsed data to `res.locals[source]`, returns 400 on failure (`finance-service/src/middlewares/validate.middleware.ts`).
- `auth-service` has both `validate()` (writes to `res.locals`) and `validateBody()` (overwrites `req.body`).
- Some routes parse inline with `schema.parse(...)` instead of the middleware (e.g. `finance-service/src/modules/taxes/tax.routes.ts`).

## Error handling
- Express 4 → async errors are **not** auto-caught. Every async route is wrapped in `asyncHandler` (`<service>/src/utils/asyncHandler.ts`), which does `.catch(next)`.
- `<service>/src/middlewares/error.middleware.ts`: `ZodError` → 400; Prisma `P2002`/`P2034` → 409; else `getErrorStatus(error)`. 5xx messages are replaced with `'Internal server error'` and logged; the stack is only included when `NODE_ENV === 'development'`.
- `HttpError` (`src/utils/httpError.ts`) carries an explicit status code for expected failures.


## Persistence and integrations
- **ORM:** Prisma 5.x (`@prisma/client` + `prisma`), PostgreSQL. One `prisma/schema.prisma` per domain service; `api-gateway` has none.
- **Prisma client:** exported as a module singleton `export const prisma = new PrismaClient(...)` in `<service>/src/config/db.ts`; `connectDb()` / `disconnectDb()` helpers live in the same file.
- **No migration tooling** — only `prisma db push`. No `prisma/migrations/` directory was found.
- **Cross-service reads:** `finance-service/src/integrations/gateway.ts` and `fieldservice-service/src/integrations/gateway.ts` expose `gatewayGet(path, req)` — a `fetch` to the gateway with a 5s `AbortSignal.timeout`, passing upstream 400/401/403/404/409 through and collapsing everything else to 503.
- **Multi-tenancy:** domain records are scoped by `officeBranchId`, derived from the authenticated user's branch. Resolution helper: `marketing-service/src/utils/officeBranch.ts` (`getOfficeBranchId(res)`); finance/field-service obtain it from the actor middleware's `res.locals.documentActor.officeBranchId` (`finance-service/src/middlewares/actor.middleware.ts`).
- **Authorization:** Two patterns. `actor.middleware.ts` (finance, fieldservice) and `authorize.middleware.ts` (marketing) verify the JWT locally via JWKS, then call the gateway `auth/me` to re-read the live profile and cross-check `sub`, `role`, and `officeBranchId`. `app-manager-service/src/middlewares/authorize.middleware.ts` does **not** verify the token itself — it trusts the gateway-verified `X-User-*` headers (including `x-user-section`) because the gateway secret already proves the request passed through the gateway.
- **Event delivery (outbox pattern):** `auth-service` produces user-sync events; `finance-service` produces tax events; `marketing-service` and `fieldservice-service` consume them. Producers expose a `wake*()` function to nudge the delivery worker; consumers expose `processDue*()` as an in-request fallback. Marketing also consumes field-service work-order events.
- **External storage:** `marketing-service` uses `@aws-sdk/client-s3` + presigner, `multer` (uploads), `exceljs` (Excel), `pdfkit` (PDF), `yauzl` (zip). Provider is **UNKNOWN** (see `DECISIONS.md`).

## Cross-cutting concerns
- **Auth:** RS256 JWT issued by `auth-service` (`jsonwebtoken`), verified via the Auth Service JWKS (`jose` in the gateway and domain services). `auth-service/src/app.ts` serves `/.well-known/jwks.json`. The access token is accepted from the `Authorization` header or an `accessToken` cookie (`src/utils/requestTokens.ts`). The access token carries `sub`, `role`, `section`, and `officeBranchId` claims; the gateway forwards them as `X-User-*` headers.
- **Refresh tokens:** stored server-side with a `familyId`; reuse of a revoked token revokes the whole family (`auth-service/src/modules/auth/auth.service.ts`). `JWT_REFRESH_SECRET` must be at least 32 characters (Zod-enforced).
- **Internal service auth:** per-service gateway secret (`x-gateway-secret`), plus `x-service-name`/`x-service-secret` for service-to-service identity at the gateway.
- **Request tracing:** `requestIdMiddleware` sets/reads `x-request-id`; echoed in every response envelope and in logs.
- **Logging:** `winston` via `<service>/src/utils/logger.ts`.
- **Rate limiting:** gateway only (`express-rate-limit`). A global per-IP limiter plus a tighter `authRateLimiter` on `POST /api/v1/auth/{login,register,refresh-token}`.
- **Helmet** on every service.
- **Config:** every service validates env with Zod in `src/config/env.ts` and calls `process.exit(1)` on invalid config.
- **Direct dev access:** `DIRECT_MFE_ACCESS` + `DIRECT_MFE_ORIGIN` let a local microfrontend bypass the gateway secret on user-facing routes only (finance, marketing, fieldservice). Health checks and internal event routes remain gateway-only. Zod-validated to require `NODE_ENV === 'development'` (`finance-service/src/config/env.ts`).
- **OpenAPI:** hand-written in `api-gateway/src/docs/*.ts`, assembled in `api-gateway/src/docs/openapi.ts` (`openapi: 3.0.3`, version `2.7.0`), served at `/api-docs` and `/api-docs.json`.

## Response envelope
Consistent across services:
```json
{ "status": 200, "success": true, "message": "...", "data": {...}, "requestId": "<x-request-id>" }
```
Errors: `{ "status": <code>, "success": false, "message": "...", "requestId": "..." }`.

