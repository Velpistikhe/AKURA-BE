# Technical decisions

Record only durable, confirmed decisions.

Format:

## YYYY-MM-DD — Short title
- Decision:
- Reason:
- Affected modules:
- Evidence paths:
- Compatibility considerations:

---

## Undated (inferred from code — confirm before relying on them)

The items below are **observable in the code** but have no ADR, commit message, or comment stating the rationale. Treat as "current behavior", not approved decisions.

### Gateway-only ingress
- **Decision:** Every request must traverse `api-gateway`. Domain services reject requests whose `x-gateway-secret` header does not match `env.GATEWAY_SECRET` (403).
- **Evidence:** `api-gateway/src/config/services.config.ts` (gateway injects the secret), `finance-service/src/middlewares/gateway.middleware.ts`, `auth-service/src/middlewares/gateway.middleware.ts`.
- **Compatibility:** A dev-only bypass exists (`DIRECT_MFE_ACCESS` + `DIRECT_MFE_ORIGIN`), restricted to `NODE_ENV === 'development'` and to user-facing routes only — health checks and internal event routes stay gateway-only.

### Per-service gateway secrets
- **Decision:** Each downstream service has its **own** secret; the gateway injects the matching one per target. Zod validation refuses to boot if secrets are duplicated or if a service URL is configured without its secret.
- **Evidence:** `api-gateway/src/config/env.ts` (`superRefine`), `api-gateway/src/routes/proxy.routes.ts` (`proxyReq.setHeader('x-gateway-secret', ...)`).

### Gateway strips inbound identity headers
- **Decision:** The gateway removes any client-supplied `X-User-*`, `X-Office-Branch-ID`, and `X-Service-*` headers before proxying, then re-injects only values derived from the verified JWT. It also strips `x-vercel-id` to avoid `INFINITE_LOOP_DETECTED` (508).
- **Reason (stated in code):** prevents header spoofing.
- **Evidence:** `api-gateway/src/routes/proxy.routes.ts`.

### Identity via trusted headers, not a shared secret
- **Decision:** The gateway is the only component that verifies the JWT (RS256, via the Auth JWKS). Downstream services trust `X-User-*` headers *only* because the gateway secret proves the call came through the gateway.
- **Evidence:** `api-gateway/src/middlewares/auth.middleware.ts`, `api-gateway/src/utils/tokens.ts`, `auth-service/src/app.ts` (`/.well-known/jwks.json`).

### Server-to-server events use a separate identity path
- **Decision:** Internal event endpoints are mounted **before** user authentication and are protected by `x-service-name` + `x-service-secret` (`timingSafeEqual`), restricted to `POST` and to a declared `internalCaller`.
- **Evidence:** `api-gateway/src/middlewares/serviceCaller.middleware.ts`, `api-gateway/src/routes/proxy.routes.ts`, `api-gateway/src/config/services.config.ts` (`internalCaller` entries).


### Office-branch multi-tenancy
- **Decision:** Every domain record is scoped by `officeBranchId`, taken from the authenticated user. Where the actor middleware is used, the live profile is re-read from the gateway `auth/me` and the JWT `sub`/`officeBranchId` are cross-checked, so a stale token cannot cross branches.
- **Evidence:** `finance-service/src/middlewares/actor.middleware.ts`, `marketing-service/src/utils/officeBranch.ts`.

### Transactional outbox for cross-service events
- **Decision:** User-sync (auth → marketing/field-service) and tax (finance → marketing) events use a DB outbox with a delivery worker, an in-request fallback (`processDue*()`), and PostgreSQL advisory locks for resync.
- **Evidence:** `auth-service/src/modules/user-sync/user-sync.{service,delivery}.ts`, `finance-service/src/modules/taxes/tax-delivery.ts`, `finance-service/src/modules/taxes/tax.routes.ts` (`pg_advisory_xact_lock`).

### Refresh-token rotation with reuse detection
- **Decision:** Refresh tokens are stored server-side with a `familyId`. Presenting an already-revoked token revokes the entire family.
- **Evidence:** `auth-service/src/modules/auth/auth.service.ts` (`revokeTokenFamily`).

### Express 4 + explicit async error propagation
- **Decision:** Express 4 is used everywhere. Every async handler is wrapped in `asyncHandler` (`.catch(next)`) because Express 4 does not forward rejected promises.
- **Evidence:** all `*/package.json` (`express: ^4.x`), `<service>/src/utils/asyncHandler.ts`.

### Prisma push instead of migrations
- **Decision:** Schema changes are applied with `prisma db push`; no `prisma/migrations/` directory exists.
- **Evidence:** `<service>/package.json` (`db:push`), `*/prisma/` contents.

### Zod-validated environment with fail-fast
- **Decision:** Each service parses `process.env` with Zod in `src/config/env.ts` and calls `process.exit(1)` with a formatted error on invalid config.
- **Evidence:** `api-gateway/src/config/env.ts`, `finance-service/src/config/env.ts`.

### CommonJS runtime with NodeNext source syntax
- **Decision:** No manifest sets `"type": "module"`, so the emitted `dist/` is CommonJS even though source uses ESM `import`/`export` with `.js` specifiers and `moduleResolution: NodeNext`.
- **Compatibility:** `http-proxy-middleware` v4 is ESM-only, so it must be loaded via dynamic `import()` — see `api-gateway/src/routes/proxy.routes.ts`.
- **Evidence:** `*/package.json` (no `type` field), `*/tsconfig.json`, `api-gateway/dist/app.js`.

### Access token carries the section claim; gateway forwards it
- **Decision:** The RS256 access token now includes a `section` claim alongside `sub`, `role`, and `officeBranchId`. The gateway injects it as `x-user-section` after verifying the token and strips any inbound copy before proxying.
- **Reason:** app-manager authorizes section-scoped menu access and must not call back into auth-service on every request; the claim lets it resolve the section from the trusted header.
- **Affected modules:** `auth-service/src/utils/tokens.ts`, `api-gateway/src/middlewares/auth.middleware.ts`, `api-gateway/src/routes/proxy.routes.ts`.
- **Compatibility:** Tokens issued before this change lack `section`; `/my-menus` treats a missing section as `null` (only `section: null` access rows match) until the token refreshes (≤15m).

### app-manager trusts gateway-verified identity headers
- **Decision:** `app-manager-service` no longer verifies the JWT itself, no longer fetches `auth/me`, and no longer carries `jose`, `serviceUrl`, `requestTokens`, or `types/auth.types`. Role checks read `x-user-id` / `x-user-role` / `x-user-section` from headers the gateway set.
- **Reason:** The gateway already enforces `authRequired: true` for `/api/v1/app-manager` and the `x-gateway-secret` check proves the request passed through it; independent verification duplicated work and created a call-back dependency on auth-service.
- **Affected modules:** `app-manager-service/src/middlewares/authorize.middleware.ts`, `src/app.ts`, `src/config/env.ts`, `package.json`.
- **Compatibility:** app-manager requires the gateway on every path (no direct-MFE bypass), so the headers are always present when the request is authorized.

### CORS wildcard rejected in production
- **Decision:** The gateway fails startup when `NODE_ENV=production` and `CORS_ORIGIN` is `*`, because `credentials: true` combined with a reflected origin lets any site read authenticated responses using the victim's cookies. Non-production still warns.
- **Evidence:** `api-gateway/src/config/env.ts` (`superRefine`), `api-gateway/src/app.ts` (`origin: env.CORS_ORIGIN === '*' ? true : ...`).

### Tighter rate limit on credential endpoints
- **Decision:** `authRateLimiter` caps `POST /api/v1/auth/{login,register,refresh-token}` per IP (`AUTH_RATE_LIMIT_MAX_REQUESTS`, default 10 per `AUTH_RATE_LIMIT_WINDOW_MS`), in addition to the global limiter.
- **Reason:** The global limiter (100/15min/IP) is too permissive for brute-force attempts against a single account.
- **Evidence:** `api-gateway/src/middlewares/rateLimiter.middleware.ts`, `api-gateway/src/app.ts`.

### Refresh secret length enforced
- **Decision:** `JWT_REFRESH_SECRET` must be at least 32 characters; startup fails otherwise. The `.env.example` placeholder is replaced with a generate-your-own instruction.
- **Evidence:** `auth-service/src/config/env.ts`, `auth-service/.env.example`.

## Open questions
- **Node `engines` for the 5 domain services** — only `api-gateway` declares them. Target runtime for the others is undetermined.
- **Test strategy** — the repository currently has no test runner, no `test` script, and no test files. Whether the team intends to adopt one is undecided. See `COMMANDS.md`.
- **Lint/format tooling** — none configured.
- **Migration tooling** — `db:push` only; production rollout/rollback procedure is undocumented.
- **S3-compatible storage provider** — `marketing-service` uses `S3Client` with `AWS_ENDPOINT_URL_S3` and `forcePathStyle: true`; the actual provider (MinIO / AWS / R2 / other) is unconfirmed.
- **Production deployment platform** — `vercel.json` exists for 4 of 6 services and the gateway has Vercel-specific handling, but this does not prove production runs on Vercel.
- **OpenAPI coverage target** — the hand-written spec in `api-gateway/src/docs/openapi.ts` does not cover every downstream route.
- **Frontend location** — no client-facing frontend exists in this repository.
- **JWKS key rotation overlap** — `accessKey.ts` exposes a single key; rotating it invalidates live tokens after the 10-minute JWKS cache. No overlap/rotation runbook exists.
- **`POST /register` exposure** — registration is open at the route level (now rate-limited, not blocked). Whether that is intended for production is undecided.
- **Access-token revocation** — no blacklist; a logout leaves the issued access token valid until it expires (≤15m).
- **CSRF posture** — refresh cookies are `SameSite=None; Secure` when deployed; no CSRF token exists. CORS allowlisting (above) is the main control.
