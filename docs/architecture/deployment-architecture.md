# Deployment Architecture

> How the platform is configured, what runs where, and — importantly — what
> this repository does **not** establish about production.
> Confidence labels are defined in [`README.md`](./README.md#3-confidence-labels).

---

## 1. What this repository contains

**VERIFIED** — the following deployment artifacts exist:

| Service | `vercel.json` | `@vercel/nft` dependency | `VERCEL` env handling |
|---|---|---|---|
| `api-gateway` | **Yes** | No | Yes |
| `auth-service` | **Yes** | No | Yes |
| `app-manager-service` | **Yes** | No | Yes |
| `marketing-service` | **Yes** | **Yes** | Yes |
| `finance-service` | **No** | No | Yes |
| `fieldservice-service` | **No** | No | Yes |

**VERIFIED** — the following do **not** exist anywhere in the repository:

- No `Dockerfile` or `docker-compose.yml`
- No `.github/` directory or any CI workflow file
- No Terraform, CloudFormation, or other IaC
- No root `package.json` or workspace configuration
- No shared deployment script

**Conclusion:** deployment is configured **entirely outside this repository**.
The repository contains service code and configuration contracts; the platform
on which it runs is not described here.

---

## 2. The gateway's `vercel.json`

**VERIFIED** — `api-gateway/vercel.json` is the only `vercel.json` with
non-trivial content:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "express",
  "buildCommand": null,
  "outputDirectory": null
}
```

`buildCommand: null` and `outputDirectory: null` mean the platform does not
build or serve a static bundle — it runs the Express app as a serverless
function.

The gateway also handles Vercel-specific concerns at runtime:

| Concern | Handling |
|---|---|
| `x-vercel-id` header | Stripped before proxying — *"Reusing the incoming Vercel marker can trigger INFINITE_LOOP_DETECTED (508)"* (`proxy.routes.ts:33-36`) |
| Client IP | `app.set('trust proxy', 1)` only when `process.env.VERCEL === '1'` (`app.ts:42-44`), so `req.ip` is the real client for rate limiting |
| ESM-only dependency | `http-proxy-middleware` v4 is loaded via dynamic `import()` so the CommonJS build Vercel produces still works (`proxy.routes.ts:23-26`) |
| Deployment detection | `process.env.VERCEL === '1'` gates cookie security and the direct-access bypass |

---

## 3. Runtime configuration

### 3.1 Environment validation

**VERIFIED** — every service validates its environment with a `zod` schema at
startup (`src/config/env.ts`). The service **exits** rather than starting with
an invalid configuration.

**VERIFIED** — the gateway's schema includes cross-field refinements that
prevent whole classes of misconfiguration:

| Rule | Effect |
|---|---|
| `FINANCE`/`FIELDSERVICE` URL and secret must be **both** present or **both** absent | A half-configured service can never start (`api-gateway/src/config/env.ts:72-76`) |
| No two gateway secrets may be equal | One service's secret cannot authenticate as another (`env.ts:84-90`) |
| `CORS_ORIGIN` must not be `*` when `NODE_ENV=production` | Credentials + wildcard origins is rejected (`env.ts:62-68`) |
| In development, a remote target must be approved | The four domain services accept a local host, a Neon development host (`*.neon.tech`), and the deployed Gateway (`akura-api-gateway.vercel.app`); the Gateway and Auth Service accept only a host listed in `DEV_ALLOWED_REMOTE_HOSTS`. Any other host - a production branch, a production deployment, a typo - is still refused |
| Sync secrets must be ≥ 32 characters | Weak shared secrets are rejected at startup |
| Gateway secret on every request in production | Deployed services and Auth require `x-gateway-secret`. Local development may call the four domain services directly with a Bearer token when not on Vercel; `/internal/*` and Auth stay gateway-only (`*/src/middlewares/gateway.middleware.ts`, `*/src/utils/localDirectAccess.ts`) |

**This is a strong pattern.** The environment schema is the real deployment
contract, and it is enforced by the process refusing to boot.

### 3.2 Configuration inventory

**VERIFIED** — the variables that differ per environment:

| Variable | Used by | Purpose |
|---|---|---|
| `PORT` | all | Listen port |
| `NODE_ENV` | all | `development` \| `production` \| `test` |
| `DEV_ALLOWED_REMOTE_HOSTS` | gateway, auth | Comma-separated hosts this development run may reach besides the local machine; the four domain services do not read it and approve the Neon development branch and the deployed Gateway by a fixed policy |
| `DATABASE_URL` | 5 domain services | PostgreSQL connection string |
| `API_GATEWAY_URL` | app-manager, marketing, finance, fieldservice | Base URL for all outbound calls |
| `AUTH_SERVICE_URL` | gateway | Auth service base URL |
| `AUTH_JWKS_URL` | gateway, marketing, finance, fieldservice | JWKS endpoint |
| `APP_MANAGER_SERVICE_URL` | gateway | App Manager base URL |
| `MARKETING_SERVICE_URL` | gateway | Marketing base URL |
| `FINANCE_SERVICE_URL` | gateway | Finance base URL (conditional) |
| `FIELDSERVICE_SERVICE_URL` | gateway | Field Service base URL (conditional) |
| `*_GATEWAY_SECRET` (×5) | gateway + each service | Per-service gateway authentication |
| `TAX_SYNC_SECRET` | finance, marketing | Tax event authentication |
| `WORK_ORDER_SYNC_SECRET` | fieldservice, marketing | Work-order event authentication |
| `JWT_ACCESS_PRIVATE_KEY_PATH` / `..._BASE64` | auth | RSA signing key |
| `JWT_ACCESS_KEY_ID` | auth | `kid` published in the JWKS |
| `JWT_ISSUER` / `JWT_AUDIENCE` | auth + all consumers | Token scoping |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | auth | Token lifetimes |
| `JWT_REFRESH_SECRET` | auth | Refresh token signing key |
| `JWT_REFRESH_IDLE_TIMEOUT_MINUTES` | auth | Refresh token idle limit |
| `CORS_ORIGIN` | gateway, marketing, finance, fieldservice | Allowed browser origins |
| `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*` | gateway | Rate limiting |

| `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` | marketing | Quotation PDF storage |
| `TAX_DELIVERY_TARGETS` | finance | JSON array of `{name, url}` delivery targets |
| `LOG_LEVEL` | all | Log verbosity |

**Secrets are never committed.** `.gitignore` excludes `.env`, `.env.*`,
`*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/`, and `credentials/`
(`.gitignore:23-31`). The local RSA private key
`auth-service/keys/access-private.pem` is confirmed untracked and ignored
(verified via `git check-ignore`).

### 3.3 Storage

**VERIFIED** — Marketing stores quotation PDFs in S3-compatible object storage
via `@aws-sdk/client-s3` with `forcePathStyle: true` and a custom
`AWS_ENDPOINT_URL_S3` (`marketing-service/src/modules/quotations/quotation-storage.ts:6-16`).

Download URLs are **presigned and short-lived — 15 minutes**
(`quotation-storage.ts:28-32`):

```ts
const expiresIn = 900;
const url = await getSignedUrl(storageClient(), new GetObjectCommand({ Bucket, Key }), { expiresIn });
return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
```

Operations are bounded: 30 s for upload, 10 s for delete.

**UNKNOWN** — the storage provider. The `AWS_ENDPOINT_URL_S3` +
`forcePathStyle` convention is compatible with MinIO, Cloudflare R2, and
other S3-compatible stores; nothing in the repository identifies which is used.

---

## 4. Local development topology

**VERIFIED** — the ports and URLs from each service's local `.env`:

```
┌──────────────────────────────────────────────────────────────┐
│  api-gateway              :5000                              │
│    ├── auth-service       :5001   (AKURA_AUTH)                │
│    ├── app-manager        :5002   (AKURA_APP_MANAGER)         │
│    ├── marketing-service  :5003   (AKURA_MARKETING)           │
│    ├── finance-service    :5004   (AKURA_FINANCE)              │
│    └── fieldservice       :5005   (AKURA_FIELD_SERVICE)        │
│                                                              │
│  PostgreSQL @ localhost:5432                                  │
│    akura_auth, akura_app_manager, akura_marketing,            │
│    akura_finance, akura_fieldservice                          │
└──────────────────────────────────────────────────────────────┘
```

**Note:** the microfrontend is not in this repository. In hybrid development the
client calls the **deployed Gateway** for login and token APIs, and the **local
domain service** on `localhost:5002`–`5005` for module APIs (see
`api-gateway/src/docs/openapi.ts` `info.description`).

### 4.1 Starting locally (full stack)

Each service is independent:

```bash
cd api-gateway          && npm install && npm run dev   # :5000
cd auth-service         && npm install && npm run dev   # :5001
cd app-manager-service  && npm install && npm run dev   # :5002
cd marketing-service    && npm install && npm run dev   # :5003
cd finance-service      && npm install && npm run dev   # :5004
cd fieldservice-service && npm install && npm run dev   # :5005
```

**There is no orchestration script.** The developer starts six terminals. The
gateway will start even if its downstream services are not running — it only
fails when a request is actually proxied.

### 4.2 Test topology

**VERIFIED** — `marketing-service/tests/support/env.ts` defines a completely
separate environment:

| Concern | Development | Test |
|---|---|---|
| Ports | 5000–5005 | 5100–5105 |
| Databases | `akura_*` | `akura_test_*` |

**VERIFIED** — the test harness has a hard safety guard that **exits the
process** if a database URL does not point at `localhost`/`127.0.0.1` with the
`_test` suffix:

> *"HARD RULE: this suite must never talk to a production or remote database.
> ... The guard fails fast (process exit) instead of skipping, because a false
> "skipped" result would be indistinguishable from a real pass in the report."*
> — `marketing-service/tests/support/env.ts:1-12`

The guard runs before any service module is imported, so an unsafe
`DATABASE_URL` can never reach a Prisma client.

### 4.3 Hybrid local development (Neon + deployed Gateway)

**VERIFIED** — one domain service on the developer machine, shared hosted auth
and data (`docs/architecture/authentication-flow.md` §8.1, ADR-0008).

| Piece | Typical value |
|---|---|
| Service process | `npm run dev` in app-manager, marketing, finance, or fieldservice |
| `NODE_ENV` | `development` |
| `DATABASE_URL` | Neon development branch (`*.neon.tech`) |
| `API_GATEWAY_URL` | `https://akura-api-gateway.vercel.app` |
| `DEV_ALLOWED_REMOTE_HOSTS` | **not used** on the four domain services — approved hosts are fixed in `src/config/env.ts` |
| Browser auth | Login/refresh/JWKS/`/auth/me` → deployed Gateway |
| Browser module API | `http://localhost:5002`–`5005` + `Authorization: Bearer` |
| Gateway secrets | Local `GATEWAY_SECRET` must match the deployed gateway's `*_GATEWAY_SECRET` for outbound `auth/me` calls |

Copy from each service's `.env.example`; hybrid lines are documented there.

---

## 5. Production topology — what is and isn't established

### 5.1 What the repository suggests

**INFERRED** — the following is a reasonable reading of the evidence, not a
documented fact:

| Signal | Reading |
|---|---|
| `vercel.json` in 4 of 6 services | Vercel is the intended host for at least those four |
| `process.env.VERCEL === '1'` checks in all 6 services | The codebase anticipates running on Vercel |
| `@vercel/nft` in marketing only | Marketing bundles its Prisma client / assets for a Vercel-style deploy |
| `buildCommand: null`, `outputDirectory: null` | Serverless function execution, not a container or static build |
| No `Dockerfile` | No container-based deployment path exists in the repo |
| Finance and Field Service have no `vercel.json` | Either they deploy elsewhere, or their deployment config simply was not committed |

**UNKNOWN** — for each of the following, nothing in this repository establishes
an answer:

| Question | Status |
|---|---|
| What platform hosts each service in production? | **UNKNOWN** |
| Which regions are services deployed in? | **UNKNOWN** |
| How are the 5 PostgreSQL databases provisioned and backed up? | **UNKNOWN** |
| How are secrets managed and rotated in production? | **UNKNOWN** |
| What is the CI/CD pipeline? | **UNKNOWN** — no workflow file exists |
| Is there a staging environment? | **UNKNOWN** |
| What is the S3-compatible storage provider? | **UNKNOWN** |
| Is TLS terminated at a load balancer, CDN, or the platform? | **UNKNOWN** |
| Is there a WAF, edge rate limiter, or DDoS protection? | **UNKNOWN** |
| How are database migrations applied in production? | **UNKNOWN** — no migration files exist |
| What is the scaling model? Long-running or serverless? | **UNKNOWN** — the worker code supports both |
| Where is the frontend deployed? | **UNKNOWN** — not in this repository |

### 5.2 The serverless question

**VERIFIED** — the outbox delivery code explicitly supports a serverless
deployment model:

> *"Run a bounded batch inside the HTTP invocation. This also works when the
> Express app is imported without server.ts (and no timer worker is started)."*
> — `finance-service/src/modules/taxes/tax-delivery.ts:42-43`

**VERIFIED** — the counterpart in Finance:

> *"Run a bounded batch inside the HTTP invocation. This also works when the
> Express app is imported without server.ts (and no timer worker is started)."*
> — `finance-service/src/modules/taxes/tax-delivery.ts:42-43`

**INFERRED** — the platform is designed to work either way. On a long-running
server, the timer worker delivers promptly. On a serverless platform, the
in-request fallback delivers during the request that produced the event, and
the timer worker handles the rest on a cold start.

**Operational consequence:** on a serverless platform, delivery latency depends
on whether a request that triggers the outbox is actually made. A tax changed
but never touched again may not reach Marketing until the next request that
triggers a batch. **UNKNOWN** — whether a platform-level scheduler invokes the
worker periodically was not established.

### 5.3 Startup and shutdown

**VERIFIED** — `src/server.ts` in each domain service:

- Validates the environment; exits on failure.
- Starts the HTTP listener.
- Starts the outbox worker (Auth, Finance) and returns a stop function.
- The stop function clears the timer on shutdown.

**VERIFIED** — the gateway and the other three services do not start a worker.

---

## 6. Health checks and operational endpoints

**VERIFIED**:

| Endpoint | Service | Purpose |
|---|---|---|
| `GET /health` | api-gateway | Gateway liveness; reports the service registry |
| `GET /services` | api-gateway | The active routing table — the way to confirm which prefixes are registered |
| `GET /api/v1/{service}/health` | each domain service | Per-service liveness, proxied through the gateway |

**VERIFIED** — the per-service health endpoints are **documented in the
OpenAPI spec** (`/api/v1/auth/health`, `/api/v1/app-manager/health`,
`/api/v1/marketing/health`, `/api/v1/finance/health`,
`/api/v1/fieldservice/health`).

**Note:** `GET /services` is the practical way to detect the conditional-routing
risk described in
[`api-gateway-routing.md`](./api-gateway-routing.md#5-conditional-routes) —
if Finance is missing from that list, its prefix is not served.

---

## 7. Deployment checklist

Derived from the configuration contract. **Not a substitute for an actual
runbook**, which does not exist in this repository.

### 7.1 Per service

- [ ] `npm ci`
- [ ] `npm run build` (domain services run `prisma generate` first)
- [ ] `npm run db:push` — or the verified production migration procedure
- [ ] `npm start`
- [ ] Environment variables set and validated (the service refuses to start otherwise)

### 7.2 Gateway

- [ ] `AUTH_SERVICE_URL`, `AUTH_JWKS_URL`, `APP_MANAGER_SERVICE_URL`, `MARKETING_SERVICE_URL` set
- [ ] `FINANCE_SERVICE_URL` + `FINANCE_SERVICE_GATEWAY_SECRET` — **both or neither**
- [ ] `FIELDSERVICE_SERVICE_URL` + `FIELDSERVICE_SERVICE_GATEWAY_SECRET` — **both or neither**
- [ ] Five **distinct** gateway secrets, each matching the corresponding service
- [ ] `CORS_ORIGIN` set to explicit origins (not `*`)
- [ ] `RATE_LIMIT_*` and `AUTH_RATE_LIMIT_*` tuned for expected traffic

### 7.3 Auth

- [ ] RSA private key ≥ 2048 bits, supplied via path or base64
- [ ] `JWT_ACCESS_KEY_ID` set — if it changes, all consumers must refetch the JWKS
- [ ] `JWT_ISSUER` / `JWT_AUDIENCE` identical to every consumer's configuration
- [ ] `JWT_REFRESH_SECRET` ≥ 32 characters

### 7.4 Marketing

- [ ] `TAX_SYNC_SECRET` identical to Finance's
- [ ] `WORK_ORDER_SYNC_SECRET` identical to Field Service's
- [ ] S3 credentials and bucket configured; the 15-minute presigned URL policy confirmed acceptable

### 7.5 Finance

- [ ] `TAX_SYNC_SECRET` identical to Marketing's
- [ ] `TAX_DELIVERY_TARGETS` configured with the gateway URL

### 7.6 Field Service

- [ ] `WORK_ORDER_SYNC_SECRET` identical to Marketing's

### 7.7 Cross-cutting

- [ ] All five `DATABASE_URL` values point at the correct, separate databases
- [ ] The `taxes` ownership conflict resolved before the next `db push`
      (see [`database-and-data-ownership.md`](./database-and-data-ownership.md#51-conflict--two-owners-claim-the-taxes-table))
- [ ] Outbox workers confirmed to be running (Auth, Finance)
- [ ] `GET /services` on the gateway shows all intended prefixes



