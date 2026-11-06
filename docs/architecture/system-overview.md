# System Overview

> Scope: the Akura backend as a whole — its purpose, architectural pattern, and
> the responsibility of each service.
> Confidence labels are defined in [`README.md`](./README.md#3-confidence-labels).

---

## 1. What this platform is

The Akura server is a **multi-service backend for a field-service / marketing
operations platform**. It manages companies and staff, a service and price
catalog, customer quotations with PDF output, work orders executed in the
field, and per-branch tax configuration.

**VERIFIED** — service descriptions are taken from each service's
`package.json` `description` field and its route modules, not from folder
names:

| Package | `package.json` description |
|---|---|
| `api-gateway` | "Express TypeScript API Gateway for Microservices Architecture" |
| `auth-service` | "PostgreSQL Express TypeScript Auth Microservice with Prisma ORM" |
| `app-manager-service` | "Modular administration microservice for Akura" |
| `marketing-service` | "Akura marketing microservice for company and service management" |
| `finance-service` | "Finance microservice for Akura" |
| `fieldservice-service` | "Field Service microservice for Akura" |

**UNKNOWN** — the client-facing frontend is **not present in this repository**.
It is referenced throughout the code as the "microfrontend" (MFE), and local
development assumes it runs on `http://localhost:4173`
(`marketing-service/src/config/env.ts:44`, `fieldservice-service/src/config/env.ts:43`).
Its location, framework, and deployment are unverified.

---

## 2. Architectural pattern

### 2.1 Gateway-as-edge

A single API Gateway is the only public entry point. Every domain service
independently rejects any request that does not carry its gateway secret.

**VERIFIED** — `verifyGatewaySecret` compares `x-gateway-secret` against
`env.GATEWAY_SECRET` and returns 403 with the message *"Access denied: requests
must pass through the API Gateway"*:

| Service | File |
|---|---|
| auth | `auth-service/src/middlewares/gateway.middleware.ts:4-18` |
| app-manager | `app-manager-service/src/middlewares/gateway.middleware.ts` |
| marketing | `marketing-service/src/middlewares/gateway.middleware.ts:5-22` |
| finance | `finance-service/src/middlewares/gateway.middleware.ts:5-31` |
| fieldservice | `fieldservice-service/src/middlewares/gateway.middleware.ts:5-22` |

### 2.2 No direct service-to-service URLs

Domain services do not know each other's addresses. They construct outbound
calls against `API_GATEWAY_URL` via a per-service helper that enforces a path
allowlist and rejects traversal.

**VERIFIED** — `<service>/src/utils/serviceUrl.ts`:

| Service | Allowed path prefixes | Source |
|---|---|---|
| auth | `auth`, `marketing`, `fieldservice` | `auth-service/src/utils/serviceUrl.ts:4` |
| app-manager | *(no `serviceUrl.ts` — makes no outbound service calls)* | verified by search: no `API_GATEWAY_URL` / `fetch(` in `app-manager-service/src` |
| marketing | `auth`, `marketing`, `fieldservice`, `finance` | `marketing-service/src/utils/serviceUrl.ts:4` |
| finance | `auth`, `marketing`, `finance`, `fieldservice` | `finance-service/src/utils/serviceUrl.ts:4` |
| fieldservice | `auth`, `marketing`, `finance` | `fieldservice-service/src/utils/serviceUrl.ts:4` |

Each helper validates the path with a regex, rejects `..` and `://`, then
returns `${API_GATEWAY_URL}/api/v1/${path}`.

**Note:** the allowlists are *broader* than what each service actually calls.
Marketing's allowlist permits `finance/`, but no `finance/` call exists in
Marketing's source. Finance permits `fieldservice/`, but Finance calls only
`auth/`. These are permissive prefixes, not evidence of a dependency.

### 2.3 No message broker

There is **no** Kafka, RabbitMQ, Redis Streams, SQS, or similar broker
anywhere in the repository — verified by searching all manifests and source for
broker clients; none are present.

Asynchronous delivery is implemented as **HTTP POST through the API Gateway**,
backed by a **transactional outbox** in the producer's own PostgreSQL
database. See [`integration-and-event-flow.md`](./integration-and-event-flow.md).

### 2.4 Database per service

Each domain service owns exactly one PostgreSQL database. There are **no**
cross-database foreign keys and no shared schema.

**VERIFIED** — `datasource db { provider = "postgresql" }` in each
`<service>/prisma/schema.prisma`, and distinct `DATABASE_URL` values per
service `.env`. See [`database-and-data-ownership.md`](./database-and-data-ownership.md).

### 2.5 Shared infrastructure conventions

Every service implements the same cross-cutting shape, largely by convention:

| Concern | Implementation |
|---|---|
| HTTP | Express 4, `helmet()`, `cors()`, `cookie-parser()` |
| Request correlation | `src/middlewares/requestId.middleware.ts` → `x-request-id` |
| Errors | `src/middlewares/error.middleware.ts`, uniform `{status, success, message, data, requestId}` envelope |
| Validation | `zod` schemas at the boundary (`src/middlewares/validate.middleware.ts`) |
| Logging | `winston` (`src/utils/logger.ts`) |
| Env validation | `zod` schema at startup; `process.exit(1)` on invalid config |
| Concurrency control | Optimistic `version` column + `409` on stale writes |
| Transactions | Prisma `$transaction`; advisory locks for serialised invariants |

---

## 3. Service responsibilities

### API Gateway — `api-gateway` (port 5000)

The platform's single edge. **VERIFIED** responsibilities:

- Reverse-proxies `/api/v1/*` to the five domain services
  (`src/routes/proxy.routes.ts`, `src/config/services.config.ts`).
- Verifies JWTs against Auth's remote JWKS and injects identity headers
  (`src/middlewares/auth.middleware.ts`).
- Authenticates internal service callers via `x-service-name` / `x-service-secret`
  with a timing-safe compare (`src/middlewares/serviceCaller.middleware.ts:15-19`).
- Applies rate limiting — a global limiter plus a tighter limiter on
  credential endpoints (`src/middlewares/rateLimiter.middleware.ts`).
- Enforces CORS, with `*` rejected in production because credentials are enabled
  (`src/config/env.ts:62-68`).
- Serves OpenAPI/Swagger at `/api-docs` and `/api-docs.json`
  (`src/app.ts:63-66`), and `/health` + `/services` (`src/app.ts:67-94`).
- Holds **no database**.

### Auth Service — `auth-service` (port 5001)

**VERIFIED** responsibilities:

- Registers, authenticates, refreshes, and logs out users.
- Issues **RS256** access tokens and **HS256** refresh tokens
  (`src/utils/tokens.ts:20-51`).
- Publishes the public key set at `GET /.well-known/jwks.json`
  (`src/app.ts:41-44`, `src/config/accessKey.ts`).
- Manages users (APP_MANAGER-only), including role, section, and office-branch
  assignment (`src/modules/user-management/`).
- Serves internal read-only lookups consumed by other services:
  `GET /users/marketing-contacts`, `GET /users/field-service/inspectors` and
  `GET /users/field-service/inspector-directory`
  (`src/modules/user-management/user-management.routes.ts:14,29,32`).
  Auth is the single source of truth for the user directory; nothing is
  replicated.
- Makes **no outbound service calls** — it only serves the profile and the
  directory.
- Writes `security_audit_logs` for login/register/logout events.

### App Manager Service — `app-manager-service` (port 5002)

**VERIFIED** responsibilities:

- **Menu administration**: `menus`, `menu_items`, `menu_accesses`
  (`src/modules/menu/`).
- **Office branch reference data** — the platform's master list of branches
  (`src/modules/reference/office-branch/`). Enforces a single-head-branch
  invariant at both the application and database level.
- **Audit trail API** — `GET /api/v1/app-manager/audit-trail`
  (`src/modules/audit-trail/`). See the fragmentation conflict documented in
  [ADR-0006](./adr/ADR-0006-audit-trail-per-service.md).
- Makes **no outbound service calls** — verified by search. It is a leaf.

### Marketing Service — `marketing-service` (port 5003)

The largest service. **VERIFIED** responsibilities:

- **Companies and staff** (`src/modules/companies/`, `src/modules/company-staff/`).
- **Service catalog**: services, scopes, items, item sizes, prices
  (`src/modules/services/`, `src/modules/items/`).
- **Contracts**: company contracts, contract prices, price history
  (`src/modules/contracts/`, `src/modules/contract-prices/`).
- **Quotations**: lifecycle (draft → submit → approve/reject/revise), item lines,
  history, PDF generation via `pdfkit`, and S3 storage (`src/modules/quotations/`).
- **Receives two asynchronous events**: tax snapshots and Work Order link
  state.
- **Maintains the replicated read model** `tax_cache`, and reads the Marketing
  contact directory live from Auth.
- Owns the `audit_logs` and `catalog_audit_logs` tables.

### Finance Service — `finance-service` (port 5004)

**VERIFIED** responsibilities:

- **Tax configuration per office branch** — the authoritative `taxes` table with
  effective-date periods (`src/modules/taxes/tax.repository.ts`).
- Writes the **tax outbox** (`tax_events`, `tax_deliveries`) and delivers
  snapshots to Marketing (`src/modules/taxes/tax-delivery.ts`).
- Exposes `GET /finance/taxes`, `GET /finance/taxes/deliveries`,
  `POST /finance/taxes`, `POST /finance/taxes/resync`.

**Note:** the invoice / proforma-invoice / billing-document modules were removed.
The source states this explicitly: *"Billing document references were removed with
the invoice and proforma invoice modules"* (`finance-service/src/integrations/gateway.ts:7-9`).

### Field Service Service — `fieldservice-service` (port 5005)

**VERIFIED** responsibilities:

- **Work Orders** — the field-execution lifecycle: `DRAFT` → `IN_PROGRESS` →
  `COMPLETED` / `CANCELED`, with soft revocation, per-branch numbering,
  inspectors, item snapshots, and history
  (`src/modules/work-orders/`).
- **Work Order options** for the creation form — live quotation and inspector
  lookups (`src/modules/options/`).
- Reads the **live Auth inspector directory** (`GET
  auth/users/field-service/inspector-directory`); nothing is replicated.
- Validates inspectors against **live Auth data** before a Work Order starts
  (`src/integrations/auth-directory.ts`).
- Notifies Marketing of Work Order link state and revocation
  (`src/integrations/gateway.ts:181-203`).

---

## 4. End-to-end walkthrough

A single request demonstrates how the pieces fit. Full detail in
[`api-gateway-routing.md`](./api-gateway-routing.md) and
[`authentication-flow.md`](./authentication-flow.md).

```
Client
  │  POST /api/v1/marketing/quotations/{id}/work-orders
  │  Authorization: Bearer <access token>
  ▼
API Gateway
  │  authRateLimiter → authenticateServiceCaller → authenticateJwt (remote JWKS)
  │  strips inbound X-User-*, injects its own, adds x-gateway-secret
  ▼
Marketing Service
  │  verifyGatewaySecret → authenticate (local JWKS) → requireMarketingAccess
  │  → GET auth/me via Gateway → re-check live profile, section, branch
  │  → POST fieldservice/work-orders via Gateway (Bearer token forwarded)
  ▼
Field Service
  │  verifyGatewaySecret → authenticate → requireActor (GET auth/me)
  │  → GET marketing/quotation-references/{id} via Gateway (snapshot basis)
  │  → persist Work Order
  │  → POST marketing/internal/work-orders/events (synchronous, in-transaction)
  ▼
Marketing Service
     attachWorkOrder(quotation, workOrder)  ← same DB transaction as the audit entry
```

Two properties of this flow are worth naming explicitly:

- **Fail-closed on upstream errors.** A timeout or 5xx from an upstream service
  becomes a `503`, never a silent `false`. See
  `marketing-service/src/modules/quotations/work-order.integration.ts:43-53`.
- **Compensating action on partial failure.** If Marketing creates the Work
  Order but then fails to persist the link, it revokes the Work Order before
  reporting the failure
  (`marketing-service/src/modules/quotations/quotation.controller.ts:178-183`).

---

## 5. Architectural characteristics

| Characteristic | Assessment | Basis |
|---|---|---|
| Service decomposition | **VERIFIED** — by domain, each with an independent database | `prisma/schema.prisma` per service |
| Entry point | **VERIFIED** — single gateway | `api-gateway/src/app.ts` |
| Inter-service transport | **VERIFIED** — HTTP through the gateway only | `*/src/utils/serviceUrl.ts` |
| Async messaging | **VERIFIED** — HTTP + transactional outbox, **no broker** | `tax-delivery.ts` |
| Consistency model | **VERIFIED** — strong within a service's transaction; **eventual** across services | outbox + version guards |
| Data isolation | **VERIFIED** — database per service, no cross-DB FK | Prisma datasources |
| Cross-cutting concern handling | **VERIFIED** — duplicated per service by convention, not shared code | identical middleware files per service |
| Shared library | **NONE** — no shared package, no monorepo | no root `package.json` |
| Observability | **PARTIAL** — structured `winston` logs and `x-request-id` propagation; **no metrics/tracing** | `src/utils/logger.ts` |
| API contract | **VERIFIED** — OpenAPI 3 spec served at the gateway, 102 path definitions | `api-gateway/src/docs/` |
| Automated tests | **VERIFIED** — 11-file reliability suite in `marketing-service/tests/` | `marketing-service/package.json:14-16` |
| CI/CD | **UNKNOWN** — no workflow file in the repository | no `.github/`, no CI config |
| Containerization | **NONE** — no Dockerfile or compose file | verified by search |

---

## 6. Design decisions behind these choices

Rationale lives in [`adr/`](./adr/README.md):

| ADR | Decision |
|---|---|
| [0001](./adr/ADR-0001-gateway-as-single-entrypoint.md) | Gateway as the single entry point |
| [0002](./adr/ADR-0002-database-per-service.md) | Database per service |
| [0003](./adr/ADR-0003-http-outbox-over-message-broker.md) | HTTP + outbox instead of a message broker |
| [0004](./adr/ADR-0004-rs256-jwt-with-remote-jwks.md) | RS256 with a remote JWKS |
| [0005](./adr/ADR-0005-layered-service-credentials.md) | Layered service credentials |
| [0006](./adr/ADR-0006-audit-trail-per-service.md) | Per-service audit trail (and its fragmentation cost) |
| [0007](./adr/ADR-0007-replace-removed-project-map-documentation.md) | Replacing the removed `.project-map` documentation |

