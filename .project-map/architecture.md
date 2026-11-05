# Project Architecture Map

> Keep this file concise; do not list every source file.
> Conventions: separate CONFIRMED facts from RISKS and DECISIONS, cite real paths, never invent details.

## Project purpose
- Backend for Akura: an Express + TypeScript microservices backend.
- Six independently deployable services, each with its own `package.json`, `package-lock.json` and `src/server.ts`:
  `api-gateway`, `app-manager-service`, `auth-service`, `fieldservice-service`, `finance-service`, `marketing-service`.
- No root `package.json` and no workspace/monorepo tooling: each service installs, builds and releases on its own.
- The API Gateway is the public edge; the five domain services own business modules and their own PostgreSQL database.
- Client-facing frontend code: UNKNOWN (not present in this repository root).

## Main entry points
- API Gateway: `api-gateway/src/server.ts` -> `api-gateway/src/app.ts`; proxy in `api-gateway/src/routes/proxy.routes.ts`, routing table in `api-gateway/src/config/services.config.ts`, env guard in `api-gateway/src/config/env.ts`.
- app-manager-service: `app-manager-service/src/server.ts` -> `src/app.ts` -> `src/routes/index.ts`.
- auth-service: `auth-service/src/server.ts` -> `src/app.ts` (no `src/routes/index.ts`; routers mount directly in `src/app.ts`), routes `src/modules/auth/auth.routes.ts`, `src/modules/user-management/user-management.routes.ts`.
- fieldservice-service: `fieldservice-service/src/server.ts` -> `src/app.ts` -> `src/routes/index.ts`; internal event router `src/modules/user-sync/user-sync.routes.ts`.
- finance-service: `finance-service/src/server.ts` -> `src/app.ts` -> `src/routes/index.ts`.
- marketing-service: `marketing-service/src/server.ts` -> `src/app.ts` -> `src/routes/index.ts`; internal event routers `src/modules/taxes/tax-events.routes.ts`, `src/modules/user-sync/user-sync-events.routes.ts`, `src/modules/quotations/work-order-events.routes.ts`.
- Gateway self-service endpoints: `/health`, `/services`, `/api-docs`, `/api-docs.json` (`api-gateway/src/app.ts`).

## Major modules
- Gateway / edge: reverse proxy + auth guard (`api-gateway/src/routes/proxy.routes.ts`, `src/middlewares/auth.middleware.ts`, `src/middlewares/serviceCaller.middleware.ts`, `src/middlewares/rateLimiter.middleware.ts`, `src/middlewares/requestId.middleware.ts`).
- App Manager: menu, menu items, menu access, office-branch reference data (`app-manager-service/src/modules/menu/**`, `src/modules/reference/office-branch/**`).
- Auth: login/token issuance, user management, outbound user-sync events (`auth-service/src/modules/auth/**`, `src/modules/user-management/**`, `src/modules/user-sync/**`).
- Field Service: work orders, options, inbound user-sync events (`fieldservice-service/src/modules/work-orders/**`, `src/modules/options/**`, `src/modules/user-sync/**`).
- Finance: taxes and outbound tax delivery (`finance-service/src/modules/taxes/**`).
- Marketing: quotations, contracts, contract prices, items, services, companies, company staff, taxes, inbound user-sync/work-order events (`marketing-service/src/modules/**`).
- Cross-cutting per service: `src/middlewares/gateway.middleware.ts` (gateway-secret verification), `src/middlewares/auth.middleware.ts`, `src/middlewares/authorize.middleware.ts`, `src/middlewares/actor.middleware.ts`, `src/middlewares/error.middleware.ts`, `src/utils/logger.ts`, `src/config/env.ts` (zod-validated environment).

## CONFIRMED: trust model and identity chaining
- Every service-to-service hop goes through the API Gateway. No service knows another's direct URL; outbound calls are built by `src/utils/serviceUrl.ts`, which requires `API_GATEWAY_URL`, rejects `..` and `://`, and pins a per-service prefix allowlist (auth `auth|marketing|fieldservice`, marketing `auth|marketing|fieldservice|finance`, fieldservice `auth|marketing|finance`, finance `auth|marketing|finance|fieldservice`, app-manager `auth|marketing`).
- On every proxied request the gateway strips inbound `X-User-ID`, `X-User-Role`, `X-User-Name`, `X-User-Email`, `X-User-Username`, `X-Office-Branch-ID`, `X-Service-Name`, `X-Service-Secret`, plus `x-vercel-id`, then re-adds identity **only after** `authenticateJwt` succeeds and only when that route has `authRequired: true` (`api-gateway/src/routes/proxy.routes.ts`). Every downstream request carries `x-gateway-secret`. Proxy failure returns HTTP 503.
- Domain services never trust the forwarded headers alone. Typical chain: `verifyGatewaySecret` -> `authenticate` (local RS256 verify) -> `authorize`/`actor` middleware that calls `GET auth/me` and cross-checks the live profile against both the token and the gateway headers. Divergence raises 401 (`authorise` files: `marketing-service/src/middlewares/authorize.middleware.ts`, `app-manager-service/src/middlewares/authorize.middleware.ts`, `fieldservice-service/src/middlewares/actor.middleware.ts`, `finance-service/src/middlewares/actor.middleware.ts`).
- Auth material: RS256 access tokens. `auth-service/src/config/accessKey.ts` loads the private key (from `JWT_ACCESS_PRIVATE_KEY_PATH`, RSA >= 2048 bits enforced at load) and exposes `GET /.well-known/jwks.json`. Gateway and domain services read it with `jose.createRemoteJWKSet` plus `algorithms: ['RS256']`, issuer and audience checks, ~10 min cache (`api-gateway/src/utils/tokens.ts`, each service's `src/utils/tokens.ts`).
- Environmental guard: `api-gateway/src/config/env.ts` fails startup if `FINANCE`/`FIELDSERVICE` URL+secret are half-configured or if any two gateway secrets are equal.

## CONFIRMED: inter-service communication
Two patterns, both always via the gateway.

1. **Synchronous reference lookup** (request-scoped, fail closed):
   - Marketing -> Field Service, Work Order check and revoke compensation: `marketing-service/src/modules/quotations/work-order.integration.ts`.
   - Field Service -> Marketing, quotation/contract/item-size references: `fieldservice-service/src/integrations/gateway.ts`. Upstream JSON is projected through explicit allowlists (`toQuotationSnapshot`, `toContractSnapshot`) so no price or stray column can reach a `jsonb` snapshot column.
   - Marketing / App Manager -> Auth, live profile: each `serve.middleware.ts`.
2. **Asynchronous event delivery** (retry, idempotent, advisory-locked):
   - Auth -> Marketing and Field Service, user sync: `auth-service/src/modules/user-sync/user-sync.delivery.ts` via `x-user-sync-secret`.
   - Finance -> Marketing, tax sync: `finance-service/src/modules/taxes/tax-delivery.ts` via `x-tax-sync-secret`.
   - Field Service -> Marketing, Work Order link state: `fieldservice-service/src/integrations/gateway.ts` via `x-work-order-sync-secret`.
   - Mechanics shared by all three: `pg_try_advisory_xact_lock(hashtext(id))` so exactly one instance delivers a job; backoff `min(300000, 10000 * 2 ** min(attempt-1,5))` plus 0-999 ms jitter; receiver-side `version` guard for idempotency (`marketing-service/src/modules/user-sync/user-sync-events.routes.ts`); acknowledgement shape `{ eventId, success: true }`.
   - Receivers mount **before** `authenticate` in `*/src/app.ts` and authenticate with their own sync secret compared via `timingSafeEqual`.
   - Gateway side: an `internalCaller: '<service>'` route accepts only `POST` from that caller (`api-gateway/src/routes/proxy.routes.ts`), and `authenticateServiceCaller` matches `x-service-name`/`x-service-secret` with `timingSafeEqual` (`api-gateway/src/middlewares/serviceCaller.middleware.ts`).

Writing paths: APIs are listed as `POST /api/v1/marketing/internal/users/events`, `POST /api/v1/marketing/internal/taxes/events`, `POST /api/v1/marketing/internal/work-orders/events`, `POST /api/v1/fieldservice/internal/users/events` (`api-gateway/src/config/services.config.ts`).

## CONFIRMED: database ownership
Five Prisma datasources, every one `provider = "postgresql"`:

| Service | Database |
|---|---|
| auth-service | `akura_auth` |
| app-manager-service | `akura_auth` (shared with auth-service) |
| fieldservice-service | `akura_fieldservice` |
| finance-service | `akura_finance` |
| marketing-service | `akura_marketing` |

Evidenced by `DATABASE_URL` in each `*.env.example` and `datasource` block in each `*/prisma/schema.prisma`. Gateway holds no Prisma client. Per-service client lifecycle: `*/src/config/db.ts`.

### RISK: shared `akura_auth` database (needs DECISION)
- CONFIRMED: auth-service and app-manager-service publish into one database, and **both schemas declare the same PostgreSQL enums** `user_section` and `user_role` with identical members and identical `@@map`.
- RISK: the two Prisma schemas migrate that database independently, so editing an enum in one schema without the other leaves definitions out of step. No divergence exists today.
- RISK: `app-manager-service/prisma/schema.prisma` declares `model Tax { ... @@map("taxes") }` (line 89) with **zero references anywhere in `app-manager-service/src`**, so `db:push` provisions a dead `taxes` table in `akura_auth`. Finance owns a real `taxes` table in a different database (`akura_finance`), so this is a schema-level duplicate rather than a runtime collision.
- DECISION: keep or drop app-manager's unused `Tax` model.

### RISK: no foreign key for `User.officeBranchId`
- CONFIRMED: in `auth-service/prisma/schema.prisma` the `User.officeBranchId` column is `String? @map("office_branch_id") @db.Uuid` with `@@index([officeBranchId])` and **zero `@relation` tags in the model**, hence no FK constraint. It cannot point at `office_branches` (that table is declared only by app-manager's schema).
- RISK: branch membership is enforced purely in application code — `getOfficeBranchId` (`marketing-service/src/utils/officeBranch.ts`), refresh-token branch re-check in `authorize`/`actor` middleware, and branch assertions inside every event `superRefine`. Deleted or misspelled branch IDs are therefore not prevented by the database.

## CONFIRMED: API surface vs. documentation coverage
- Swagger documents 43 OpenAPI path entries holding 63 operations (33 get, 13 post, 8 patch, 7 delete, 2 put) in `api-gateway/src/docs/openapi.ts`.
- Coverage is materially incomplete, especially for Marketing, Finance and Field Service. Exact route-definition totals and per-prefix comparisons are **UNKNOWN / inconsistent in prior exploration**: one earlier count reported 123 routes, a later count reported 129. No route recount was performed for this documentation update. See `api-endpoints.md` for the previously collected inventory and its caveat; verify counts before using them as a benchmark.
- Largest undocumented area: Marketing `/items`, `/company-contracts`, `/company-contract-prices`, `/quotations` and the five `*-references` routes in `marketing-service/src/routes/index.ts`. Finance and Field Service are documented only by `/health`.

## Data flow
- Client -> API Gateway (`api-gateway/src/app.ts`): helmet -> cors -> requestId -> logger -> cookieParser -> `authenticateServiceCaller` -> global rate limiter -> Swagger -> proxy.
- Gateway -> downstream service (`api-gateway/src/routes/proxy.routes.ts`): `http-proxy-middleware` v4 loaded through native async `import()` with per-service `pathRewrite`; identity headers stripped then re-added after JWT verification; `x-gateway-secret` attached; failure returns HTTP 503.
- Internal (service-to-service) calls also traverse the gateway with `authRequired: false` plus the POST-only `internalCaller` guard (`api-gateway/src/config/services.config.ts`).
- Persistence: one Prisma client per service (`*/src/config/db.ts`), schemas in `*/prisma/schema.prisma`.
- Object storage: S3-compatible client for quotation files (`marketing-service/src/modules/quotations/quotation-storage.ts`, `S3Client` with `AWS_ENDPOINT_URL_S3`, `forcePathStyle: true`).

## Build and runtime
- Runtime: Node.js. `api-gateway/package.json` declares `engines.node: ^22.15.0 || ^24.0.0 || >=26.0.0`. Node engines for the five domain services: UNKNOWN (no `engines` field in any of the other manifests).
- Package manager: npm; a `package-lock.json` per service, no `packageManager` field.
- Framework: Express 4 + TypeScript, ESM-style `.js` import specifiers in source.
- Commands, identical across all six services: `dev` -> `tsx watch src/server.ts`; `build` -> `prisma generate && rimraf dist && tsc` (gateway `rimraf dist && tsc`); `start` -> `node dist/server.js`; `typecheck` -> `tsc --noEmit`.
- Schema commands, domain services only: `db:generate`, `db:push`.
- **CONFIRMED: there is no test infrastructure.** No `*.test.*`/`*.spec.*` files and no `jest.config*`/`vitest.config*` anywhere outside `node_modules`/`dist`, no `test` script in any of the six manifests, and no test runner in any `devDependencies` list (only `@types/*`, `prisma`, `rimraf`, `tsx`, `typescript`).
- Available validation today, in order of cost: `npm run typecheck` per service, then `npm run build`; the smallest relevant script is the only realistic check until a runner is adopted.

- `api-gateway/src/docs/openapi.ts` currently contains 43 OpenAPI path entries / 63 operations. Prior route totals conflict (123 vs. 129), so the exact gap is UNKNOWN until the inventory is reconciled; see `api-endpoints.md` for the route inventory and counting caveats.
- Test infrastructure is absent: no `*.test.*` / `*.spec.*`, no test script or test runner in the six manifests. Available checks: `npm run typecheck`, `npm run build` per service.

## Notes
- Last reviewed: 2026-11-04 (full pass: entry points, trust model, sync flows, Prisma datasources, route and Swagger counts, test infrastructure).
- Remaining unknowns:
  - Node engines for the five domain services (not declared).
  - Deployment platform for the five domain services; Vercel hints appear only in `api-gateway/src/app.ts`, `api-gateway/src/routes/proxy.routes.ts` and `marketing-service`'s `@vercel/nft` devDependency.
  - S3 vendor behind `AWS_ENDPOINT_URL_S3` (endpoint plus `forcePathStyle` suggests MinIO or similar, but no provider is named).
  - Client-facing frontend repository location.
  - Whether `user-sync` runs on a persistent timer in production or only from HTTP-triggered batches (`processDueUserSyncs` / `processDueTaxDeliveries` fall back to in-request batches when a timer worker is absent).
- Open decisions:
  - Keep or remove the unused `Tax` model in `app-manager-service/prisma/schema.prisma`.
  - Split app-manager into its own database, or keep the shared `akura_auth` database and accept cross-schema enum coordination.
  - Adopt a test framework; the global instruction to run tests on code changes has nothing to run against today.
  - Close the Swagger gap (verified OpenAPI count: 43 paths); the route total is inconsistent in prior reports and remains UNKNOWN pending reconciliation.