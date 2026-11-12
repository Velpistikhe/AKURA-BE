# Service Catalog

> Per-service reference: what each service owns, its stack, ports, modules,
> database, and public surface.
> Confidence labels are defined in [`README.md`](./README.md#3-confidence-labels).

---

## 1. Inventory

**VERIFIED** — six services, confirmed by root directory listing, each with its
own `package.json`, `package-lock.json`, `tsconfig.json`, and `src/server.ts`.
There is no root `package.json` and no workspace configuration, so each service
is an independent npm package that installs, builds, and releases on its own.

| # | Directory | Package name | Dev port | Database | Prisma |
|---|---|---|---|---|---|
| 1 | `api-gateway` | `api-gateway` | 5000 | none | no |
| 2 | `auth-service` | `auth-service` | 5001 | `akura_auth` | `^5.16.1` |
| 3 | `app-manager-service` | `app-manager-service` | 5002 | `akura_app_manager` | `^5.22.0` |
| 4 | `marketing-service` | `marketing-service` | 5003 | `akura_marketing` | `^5.22.0` |
| 5 | `finance-service` | `finance-service` | 5004 | `akura_finance` | `5.22.0` (pinned) |
| 6 | `fieldservice-service` | `fieldservice-service` | 5005 | `akura_fieldservice` | `5.22.0` (pinned) |

Ports are **VERIFIED** from each service's `src/config/env.ts` default and its
local `.env` `PORT` value; the two agree in every case. Test ports are offset
to 5100–5105 (`marketing-service/tests/support/env.ts:37-44`).

**Folder names match package names exactly in this repository.** This was
verified rather than assumed — see §5 for the checks performed.

---

## 2. Shared stack

**VERIFIED** across all six manifests:

| Layer | Technology |
|---|---|
| Runtime | Node.js — `api-gateway` declares `engines: ^22.15.0 \|\| ^24.0.0 \|\| >=26.0.0`; the five domain services declare **no** `engines` field (**UNKNOWN** for their production Node version) |
| Language | TypeScript 5.x, `strict: true`, `target: ES2022`, `module: NodeNext` |
| Module system | ESM — all relative imports carry an explicit `.js` extension |
| HTTP | Express 4.19–4.22 |
| Validation | `zod` 3.23–3.25 |
| Logging | `winston` 3.13–3.19 |
| Security headers | `helmet` 7.x |
| CORS | `cors` 2.8.x |
| Cookies | `cookie-parser` 1.4.x |
| ORM | `@prisma/client` 5.x + `prisma` (dev) — domain services only |
| Dev runner | `tsx watch src/server.ts` |
| Build | `rimraf dist && tsc` (domain services prepend `prisma generate`) |
| Typecheck | `tsc --noEmit` |

**No shared internal library exists.** Every service duplicates its own
`utils/logger.ts`, `utils/httpError.ts`, `utils/asyncHandler.ts`,
`utils/requestTokens.ts`, `utils/listQuery.ts`, and
`middlewares/error.middleware.ts`. This is a real cost of the no-monorepo
layout, not an oversight in the docs.

---

## 3. Service profiles

### 3.1 API Gateway

| Aspect | Detail |
|---|---|
| Entry point | `api-gateway/src/server.ts` → `src/app.ts` |
| Runtime deps | `http-proxy-middleware` 4.2.0, `jose` 6.1.0, `swagger-ui-express` 4.6.3, `swagger-ui-dist` 5.32.14, `express-rate-limit` 7.3.1 |
| Database | **None** — no Prisma, no `DATABASE_URL` |
| Modules | `config/` (env, services, swagger), `middlewares/` (auth, serviceCaller, rateLimiter, requestId, logger, error), `routes/proxy.routes.ts`, `utils/` (tokens, requestTokens, logger, localOrigin, errorDetails), `docs/` (OpenAPI source) |
| Self endpoints | `GET /health`, `GET /services`, `GET /api-docs`, `GET /api-docs.json` |
| Proxied prefixes | `/api/v1/auth`, `/api/v1/app-manager`, `/api/v1/marketing`, `/api/v1/finance`*, `/api/v1/fieldservice`* + 2 internal event prefixes |
| Outbound calls | To Auth's JWKS endpoint only (`src/utils/tokens.ts:10-15`) |
| Key config | `AUTH_SERVICE_URL`, `AUTH_JWKS_URL`, `APP_MANAGER_SERVICE_URL`, `MARKETING_SERVICE_URL`, `FINANCE_SERVICE_URL`*, `FIELDSERVICE_SERVICE_URL`*, plus one `*_GATEWAY_SECRET` per service |

\* Conditional — see [`api-gateway-routing.md`](./api-gateway-routing.md#5-conditional-routes).

**Notable**: `http-proxy-middleware` v4 is ESM-only, so the gateway loads it
through a dynamic `import()` even when compiled to CommonJS on Vercel, caching
the promise across requests (`src/routes/proxy.routes.ts:23-26, 81-86`).

### 3.2 Auth Service

| Aspect | Detail |
|---|---|
| Entry point | `auth-service/src/server.ts` → `src/app.ts` |
| Runtime deps | `@prisma/client`, `bcryptjs`, `jsonwebtoken` 9.0.2, `uuid` |
| Database | `akura_auth` |
| Modules | `auth/` (login, register, refresh, logout, profile, password), `user-management/` (CRUD) |
| Public endpoints | `POST /register`, `POST /login`, `POST /refresh-token`, `POST /logout`, `GET /me`, `PUT /profile`, `PUT /password` |
| Internal endpoints | `GET /.well-known/jwks.json` |
| APP_MANAGER-only | `GET /users/:userId`, `PATCH /users/:userId` |
| Branch-scoped read | `GET /users` — an app manager sees every user of every branch, including the deactivated ones, with the full user shape. Any other caller sees only the active users of their own branch, with the reduced shape (id, firstName, lastName, email, telp, role, section, branch); the `officeBranchId` and `isActive` filters cannot widen that scope. A caller without a branch assignment receives an empty list. |
| Key config | `JWT_ACCESS_PRIVATE_KEY_PATH` / `JWT_ACCESS_PRIVATE_KEY_BASE64`, `JWT_ACCESS_KEY_ID` (default `akura-access-key-1`), `JWT_ISSUER` (default `akura-auth`), `JWT_AUDIENCE` (default `akura-api`), `JWT_ACCESS_EXPIRES_IN` (default `15m`), `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` (default `7d`), `JWT_REFRESH_IDLE_TIMEOUT_MINUTES` (default `60`) |

The RSA key must be at least 2048 bits and is enforced at load time
(`src/config/accessKey.ts:11-18`). The private key is loaded from a file path
or a base64 environment variable; the local file
`auth-service/keys/access-private.pem` is **gitignored** and untracked
(confirmed via `git check-ignore`), so it is not part of the repository.

### 3.3 App Manager Service

| Aspect | Detail |
|---|---|
| Entry point | `app-manager-service/src/server.ts` → `src/app.ts` |
| Runtime deps | `@prisma/client`, `express`, `zod`, `winston`, `helmet`, `cors`, `cookie-parser` — **no JWT library** |
| Database | `akura_app_manager` |
| Modules | `menu/` (menus, menu-items, menu-accesses), `reference/office-branch/`, `audit-trail/` |
| Public endpoints | `GET/POST /menus`, `GET/PATCH/DELETE /menus/:menuId`, `GET /menus/my-menus`, `GET/POST /menu-items`, `GET/PATCH/DELETE /menu-items/:menuItemId`, `GET/POST /menu-accesses`, `GET/PATCH/DELETE /menu-accesses/:menuAccessId`, `GET/POST /office-branches`, `GET/PATCH/DELETE /office-branches/:officeBranchId`, `GET /office-branches/options`, `GET /audit-trail`, `GET /audit-trail/entity/:entityId` |
| Authorization | `requireAppManager` — reads identity from the gateway's `X-User-*` headers only (`src/middlewares/authorize.middleware.ts:35-53`) |
| Outbound calls | `GET auth/me` through `API_GATEWAY_URL` when a request arrives without gateway headers (`authorize.middleware.ts`) |
| Local development | Direct browser access on `http://localhost:5002` with Bearer token (`localDirectAccess.ts`); `/internal/*` stays gateway-only |
| Special | Has a hand-written SQL migration: `prisma/sql/0001_single_head_office_branch.sql`, applied by `npm run db:migrate` (`scripts/apply-migrations.mjs`), enforcing the single-head-branch invariant with a partial unique index that Prisma cannot express |

**Note:** this service does **not** verify JWTs itself. It trusts the
gateway-verified `X-User-*` headers, justified by the gateway secret check.
See [`authentication-flow.md`](./authentication-flow.md#4-two-authorization-models).

### 3.4 Marketing Service

| Aspect | Detail |
|---|---|
| Entry point | `marketing-service/src/server.ts` → `src/app.ts` |
| Runtime deps | `@aws-sdk/client-s3` 3.1131, `@aws-sdk/s3-request-presigner`, `exceljs` 4.4, `pdfkit` 0.20.2, `multer` 2.3, `yauzl` 3.4, `jose`, `@prisma/client` |
| Database | `akura_marketing` |
| Modules | `companies/`, `company-staff/`, `contract-prices/`, `contracts/`, `items/`, `quotations/`, `services/`, `taxes/` |
| Inbound event endpoints | `POST /internal/taxes/events`, `POST /internal/quotations/:quotationId/work-order` — mounted **before** `authenticate` (`src/app.ts:23-25`) |
| Outbound calls | `GET auth/me` (live profile check), `GET fieldservice/work-orders/by-quotation/:id` (live Work Order lookup before a quotation revision or deletion), `GET auth/.well-known/jwks.json` |
| Key config | `TAX_SYNC_SECRET`, `WORK_ORDER_SYNC_SECRET` (each min 32 chars), `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (default `us-east-2`), `AWS_S3_BUCKET` (default `akura`) |
| Special | The only service with a test suite. Also the only one with a `vercel.json` **and** `@vercel/nft` as a dependency |

**Local development**: routes mount at `/`; the microfrontend calls
`http://localhost:5003` with `Authorization: Bearer` (paths match what the
gateway forwards after stripping `/api/v1/marketing`). See OpenAPI `info.description`.

### 3.5 Finance Service

| Aspect | Detail |
|---|---|
| Entry point | `finance-service/src/server.ts` → `src/app.ts` |
| Runtime deps | `@prisma/client`, `jose`, `express`, `zod`, `winston` — the smallest service |
| Database | `akura_finance` |
| Modules | `taxes/` only — `tax.routes.ts`, `tax.repository.ts`, `tax.schemas.ts`, `tax-delivery.ts` |
| Public endpoints | `GET /taxes`, `GET /taxes/deliveries`, `POST /taxes`, `POST /taxes/resync` |
| Outbound calls | `GET auth/me`, `GET auth/.well-known/jwks.json`, and the async tax delivery POST |
| Key config | `TAX_DELIVERY_TARGETS` (JSON array of `{name, url}`), `TAX_SYNC_SECRET`, |
| Special | `TAX_DELIVERY_TARGETS` URLs are validated at startup to equal the configured gateway URL — a tax snapshot can only be delivered through the gateway (`src/modules/taxes/tax-delivery.ts:22`) |
| Local development | Direct browser access on `http://localhost:5004` with Bearer token |

Tax write permission requires role `ADMIN` **and** section `FINANCE` or
`MARKETING` (`src/middlewares/actor.middleware.ts:18`).

### 3.6 Field Service Service

| Aspect | Detail |
|---|---|
| Entry point | `fieldservice-service/src/server.ts` → `src/app.ts` |
| Runtime deps | `@prisma/client`, `jose`, `express`, `zod`, `winston` |
| Database | `akura_fieldservice` |
| Modules | `work-orders/`, `options/` |
| Public endpoints | `GET /work-orders`, `GET /work-orders/:id`, `GET /work-orders/:id/history`, `GET /work-orders/by-quotation/:quotationId`, `POST /work-orders` (company basis), `POST /work-orders/from-quotation` (quotation basis), `PATCH /work-orders/:id`, `DELETE /work-orders/:id`, `POST /work-orders/:id/start`, `GET /options/quotations`, `GET /options/quotations/:quotationId` |
| Outbound calls | `GET auth/me`, `GET marketing/quotation-references*`, `GET marketing/companies/:companyId`, `GET marketing/contract-references*`, `GET marketing/item-size-references*`, `GET auth/.well-known/jwks.json`, and the work-order status callback POST |
| Key config | `WORK_ORDER_SYNC_SECRET`, |
| Special | `requireWorkOrderReferenceActor` admits sections MARKETING, FIELD_SERVICE, FINANCE, ACCOUNTING for read-only reference access; `requireActor` for mutations admits only MARKETING and FIELD_SERVICE (`src/middlewares/actor.middleware.ts:22-23`). Has a hand-written SQL migration: `prisma/sql/0001_drop_work_order_inspector_user_id.sql`, applied by `npm run db:migrate` (`scripts/apply-migrations.mjs`), dropping the inspector user ID column |
| Local development | Direct browser access on `http://localhost:5005` with Bearer token |

---

## 4. Endpoint index by service

**VERIFIED** — assembled from the gateway's OpenAPI source
(`api-gateway/src/docs/*.ts`, spec version **2.8.2**). The gateway documents **98 path definitions**
across 7 files, with **no duplicate path keys** between files (verified by
extracting every path key and grouping).

| Service | Documented path count | Source files |
|---|---|---|
| Auth | 11 | `openapi.ts` |
| App Manager | 13 | `openapi.ts`, `audit-trail.ts` |
| Marketing | 55 | `catalog.ts`, `quotation.ts`, `operational-documents.ts`, `work-orders.ts`, `tax.ts` |
| Finance | 4 | `tax.ts` |
| Field Service | 9 | `work-orders.ts`, `quotation.ts` |
| Gateway-owned (`/health`, `/services`, `/api-docs`, `/api-docs.json`) | 4 | `openapi.ts` |
| Internal event endpoints | 2 | `tax.ts`, `quotation.ts` |

Per-endpoint detail, including the full routing table and header rules, is in
[`api-gateway-routing.md`](./api-gateway-routing.md).

---

## 5. Verification notes

The task required that service identity be verified through source rather than
folder names. The following checks were performed:

| Check | Method | Result |
|---|---|---|
| Service count | Root directory listing | Exactly 6 service directories + `.clinerules` + `.gitignore`. No hidden services. |
| Folder name ↔ package name | Compared directory name against `package.json` `name` | Match for all 6 |
| Folder name ↔ actual purpose | Read `package.json` `description`, `src/server.ts`, `src/app.ts`, and route modules | Descriptions are consistent with implemented routes for all 6 |
| Module name ↔ route mount | Read `src/routes/index.ts` / `src/app.ts` per service | Consistent for all 5 domain services |
| Port assignment | `src/config/env.ts` default vs `.env` `PORT` | Agree for all 6 |
| Database separation | Parsed `DATABASE_URL` host + database name per service `.env` (credentials discarded) | 5 distinct databases, all `localhost` |
| Extra services | Searched for any other `package.json`, `server.ts`, `Dockerfile`, or compose file | None found |
| Prior documentation | `git log`/`git show` on commit `ec4484c` | `.project-map/` and `.ai-context/` were deleted; their claims were re-verified independently rather than reused — see [ADR-0007](./adr/ADR-0007-replace-removed-project-map-documentation.md) |

**No service was assumed.** Every service listed here was read directly.

---

## 6. Known service-level gaps

| Item | Status | Detail |
|---|---|---|
| `app-manager-service` `Tax` model | **Orphan** — declared in `prisma/schema.prisma:89-104` mapped to table `taxes`, but zero references anywhere in `src/`. Finance owns the live table. | Risk #1 |
| `finance-service` `TaxCache` model | **Orphan** — `prisma/schema.prisma:8-16` mapped to `tax_cache`, zero references in `src/`. Marketing's `tax_cache` is the live one. | Risk #2 |
| `finance-service` `TaxSyncState` model | **Orphan** — `prisma/schema.prisma:18-21`. Both Finance and Marketing declare an unused `tax_sync_state`. | Risk #2 |
| `marketing-service` `TaxSyncState` model | **Orphan** — `prisma/schema.prisma:550-554`, zero references in `src/`. | Risk #2 |
| `finance-service` `vercel.json` | **Absent** — unlike the other four domain services | Risk #6 |
| `fieldservice-service` `vercel.json` | **Absent** — unlike the other four domain services | Risk #6 |
| Domain-service `engines` field | **Absent** — production Node version unpinned | — |
| Root `README.md` | **Absent** — the repository has no top-level readme; this catalog partially fills that gap | — |



