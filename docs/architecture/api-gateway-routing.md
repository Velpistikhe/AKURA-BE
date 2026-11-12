# API Gateway Routing

> The gateway's routing table, path rewriting, header handling, rate limits, and
> documented API surface.
> Confidence labels are defined in [`README.md`](./README.md#3-confidence-labels).
> Source of truth: `api-gateway/src/config/services.config.ts` and
> `api-gateway/src/routes/proxy.routes.ts`.

---

## 1. What the gateway does

The gateway is a **pure reverse proxy plus policy enforcement layer**. It
holds no database and no business logic.

**VERIFIED** — middleware order in `api-gateway/src/app.ts:46-96`:

| Order | Middleware | File | Purpose |
|---|---|---|---|
| 1 | `helmet()` | — | Security headers |
| 2 | `cors(corsOptions)` + `app.options('*')` | `src/app.ts:47-48` | Origin policy; `credentials: true`, exposes `Content-Disposition` |
| 3 | `requestIdMiddleware` | `src/middlewares/requestId.middleware.ts` | Correlation ID → `x-request-id` |
| 4 | `loggerMiddleware` | `src/middlewares/logger.middleware.ts` | Request logging |
| 5 | `cookieParser()` | — | Reads the `accessToken` cookie |
| 6 | `authenticateServiceCaller` | `src/middlewares/serviceCaller.middleware.ts` | Internal caller authentication |
| 7 | `globalRateLimiter` | `src/middlewares/rateLimiter.middleware.ts` | Per-IP limit |
| 8 | `authRateLimiter` | `src/app.ts:59-62` | Tighter limit on credential endpoints only |
| 9 | `/api-docs`, `/api-docs.json` | `src/app.ts:63-66` | Swagger UI + raw spec |
| 10 | `/health`, `/services` | `src/app.ts:67-94` | Gateway introspection |
| 11 | `proxyRoutes` | `src/routes/proxy.routes.ts` | The proxied prefixes |
| 12 | 404 handler | `src/app.ts:97-104` | Uniform JSON 404 |
| 13 | `errorHandler` | `src/middlewares/error.middleware.ts` | Uniform error envelope |

---

## 2. Routing table

**VERIFIED** — `api-gateway/src/config/services.config.ts:13-90`.

| Prefix | Target service | `authRequired` | `internalCaller` | Path rewrite |
|---|---|---|---|---|
| `/api/v1/marketing/internal/taxes/events` | marketing | **false** | `finance-service` | `^/` → `/internal/taxes/events` |
| `/api/v1/marketing/internal/quotations` | marketing | **false** | `fieldservice-service` | `^/` → `/internal/quotations` |
| `/api/v1/auth` | auth | **false** | — | `^/api/v1/auth` → `''` |
| `/api/v1/app-manager` | app-manager | **true** | — | `^/api/v1/app-manager` → `''` |
| `/api/v1/marketing` | marketing | **true** | — | `^/api/v1/marketing` → `''` |
| `/api/v1/finance`* | finance | **true** | — | `^/api/v1/finance` → `''` |
| `/api/v1/fieldservice`* | fieldservice | **true** | — | `^/api/v1/fieldservice` → `''` |

\* Conditional — see §5.

**Ordering matters.** The two `internal/...` prefixes are registered
**before** their parent prefixes. Since Express matches `router.use` in
registration order and `/api/v1/marketing/internal/taxes/events` is a strict
prefix of `/api/v1/marketing`, the internal route wins for those exact paths.
This ordering is load-bearing — reordering it would route internal events
through the user-facing route and break authentication.

### How the rewrite works

**VERIFIED** — confirmed by read-only runtime probe of Express +
`http-proxy-middleware` v4.2.0 behaviour:

1. Express's `router.use(prefix, handler)` strips the mount prefix from
   `req.url` before the handler runs.
2. `http-proxy-middleware` then applies `pathRewrite` to the already-stripped
   URL.

Net effect for a public route:

```
/api/v1/marketing/companies?page=1   →  Express strips  →  /companies?page=1
                                      →  pathRewrite    →  /companies?page=1
```

Net effect for an internal route:

```
/api/v1/marketing/internal/taxes/events  →  Express strips  →  /
                                           →  pathRewrite    →  /internal/taxes/events
```

The internal routes use `^/` → `/internal/...` rather than stripping the
full prefix, because Express has already removed the mount prefix by then.
This is exactly what the code comment at `services.config.ts:29` states.

---

## 3. Header handling

### 3.1 Headers stripped on every proxied request

**VERIFIED** — `api-gateway/src/routes/proxy.routes.ts:32-46`.

| Header | Reason |
|---|---|
| `x-vercel-id` | *"Each downstream deployment is a new routing hop. Reusing the incoming Vercel marker can trigger INFINITE_LOOP_DETECTED (508)."* |
| `X-User-ID`, `X-User-Role`, `X-User-Section`, `X-User-Name`, `X-User-Email`, `X-User-Username`, `X-Office-Branch-ID` | Client-supplied identity must never be trusted |
| `X-Service-Name`, `X-Service-Secret` | Client-supplied service identity must never be trusted |

**This is the anti-spoofing core of the gateway.** Inbound identity headers are
always removed and only re-added by the gateway after its own verification.

### 3.2 Headers added on every proxied request

| Header | Value | Condition |
|---|---|---|
| `x-gateway-secret` | The per-service secret for the target | Always |
| `X-Request-ID` | The gateway's correlation ID | Always (if present) |
| `X-User-ID`, `X-User-Role`, `X-User-Section`, `X-User-Name`, `X-User-Username`, `X-Office-Branch-ID` | Verified token claims | **Only when `authRequired: true`** |

Note that `X-User-Email` is stripped but never re-added — the access token
carries no email claim, so services do not receive it.

### 3.3 Internal caller authentication

**VERIFIED** — `api-gateway/src/middlewares/serviceCaller.middleware.ts`.

A request carrying `x-service-name` or `x-service-secret` is treated as an
internal call:

1. If **both** headers are absent → treated as a normal request, `next()`.
2. If **either** is present → the secret is looked up by service name and
   compared with `timingSafeEqual`. A mismatch, an unknown service name, or a
   missing secret returns **403**.

The secret lookup table (`serviceCaller.middleware.ts:5-11`) covers all five
domain services, keyed by their canonical names: `auth-service`,
`app-manager-service`, `marketing-service`, `finance-service`,
`fieldservice-service`.

**VERIFIED** — the gateway also refuses to start if two services share a
secret (`src/config/env.ts:77-90`), so one service's secret cannot
authenticate as another.

### 3.4 Internal route guards

**VERIFIED** — `proxy.routes.ts:10-18`.

For a route with an `internalCaller`, the request must:

1. Use the **`POST`** method, and
2. Carry `res.locals.serviceCaller === service.internalCaller`.

Otherwise → **403** with `"<service> credentials are required"`. This is a
second, independent check on top of the shared-secret verification inside the
receiving service.

---

## 4. Authentication on proxied routes

**VERIFIED** — `api-gateway/src/middlewares/auth.middleware.ts`.

`authenticateJwt` is applied only to routes with `authRequired: true`
(`proxy.routes.ts:19-21`).

| Step | Behaviour |
|---|---|
| Token extraction | `Authorization: Bearer <token>` first, else the `accessToken` cookie (`src/utils/requestTokens.ts`) |
| Missing token | 401 *"Unauthorized: Missing or invalid Authorization header/cookie"* |
| Verification | `jose.jwtVerify` against Auth's remote JWKS, `algorithms: ['RS256']`, issuer `akura-auth`, audience `akura-api` |
| Payload check | `sub` required, `type` must equal `'access'`, `officeBranchId` must be `null` or a string |
| Failure | 401 *"Unauthorized: Invalid or expired access token"* |
| Success | Claims are written into `req.headers['x-user-*']` for the proxy to forward |

**`/api/v1/auth` has `authRequired: false`** so that login and registration can
be reached without a token. The Auth service applies its own `authenticate`
middleware to its protected sub-routes (`auth-service/src/modules/auth/auth.routes.ts:20`).

Full detail: [`authentication-flow.md`](./authentication-flow.md).

---

## 5. Conditional routes

**VERIFIED** — `services.config.ts:68-90`.

Two services are registered **only if both** their URL and their secret are
configured:

```ts
if (env.FINANCE_SERVICE_URL && env.FINANCE_SERVICE_GATEWAY_SECRET) { ... }
if (env.FIELDSERVICE_SERVICE_URL && env.FIELDSERVICE_SERVICE_GATEWAY_SECRET) { ... }
```

**VERIFIED** — `src/config/env.ts:72-76` additionally refuses to start if
exactly one of the pair is set, so the two can never be half-configured.

**Risk:** if a service is not configured, its prefix is simply absent from the
gateway. A client calling `/api/v1/finance/taxes` receives the gateway's
generic 404 (*"Route GET /api/v1/finance/taxes not found on API Gateway"*) —
not a clear "service not configured" error. Nothing logs or alerts on the
omission. `GET /services` (`src/app.ts:81-94`) does report the active
routing table, which is the intended way to check.

**VERIFIED** — the Finance and Field Service prefixes are documented in the
OpenAPI spec regardless, so the published contract is a superset of what a
given environment actually serves.

---

## 6. Rate limiting

**VERIFIED** — `src/middlewares/rateLimiter.middleware.ts`.

| Limiter | Window | Max | Applied to |
|---|---|---|---|
| `globalRateLimiter` | `RATE_LIMIT_WINDOW_MS` (default 900000 = 15 min) | `RATE_LIMIT_MAX_REQUESTS` (default 100) | All requests |
| `authRateLimiter` | `AUTH_RATE_LIMIT_WINDOW_MS` (default 900000) | `AUTH_RATE_LIMIT_MAX_REQUESTS` (default 10) | `POST /api/v1/auth/login`, `POST /api/v1/auth/register`, `POST /api/v1/auth/refresh-token` |

Both use `standardHeaders: true`, `legacyHeaders: false`, and return a
structured 429 body.

**Both limiters skip internal service traffic** — `skip: (_req, res) =>
Boolean(res.locals.serviceCaller)`. The code comment explains: *"Internal
service traffic does not submit user credentials and must not be throttled by
the user-facing authentication limit."*

**Behind a proxy (Vercel),** `app.set('trust proxy', 1)` is applied only when
`process.env.VERCEL === '1'` (`src/app.ts:42-44`), so `req.ip` reflects the
real client rather than an arbitrary forwarded chain.

---

## 7. Error handling

| Condition | Status | Source |
|---|---|---|
| No route matched | 404 | `src/app.ts:97-104` |
| Proxy target unreachable | **503** *"Service Unavailable: Unable to reach target service for `<prefix>`"* | `src/routes/proxy.routes.ts:65-77` |
| Missing/invalid token | 401 | `src/middlewares/auth.middleware.ts` |
| Invalid internal credentials | 403 | `src/middlewares/serviceCaller.middleware.ts` |
| Wrong internal caller | 403 | `src/routes/proxy.routes.ts:13` |
| Rate limit exceeded | 429 | `src/middlewares/rateLimiter.middleware.ts` |

The proxy error handler explicitly checks `headersSent` before writing, so a
mid-stream failure does not attempt to write a second response body
(`proxy.routes.ts:69`).

---

## 8. Documented API surface

**VERIFIED** — the gateway authors a complete OpenAPI 3 document in
`api-gateway/src/docs/` and serves it at `/api-docs` and `/api-docs.json`.
The published spec version is **2.8.2**. The `info.description` and downstream
health operation descriptions document **hybrid local development**: auth via
the deployed gateway, module APIs on `localhost:5002`–`5005`, approved Neon
and gateway hosts without `DEV_ALLOWED_REMOTE_HOSTS` on the four domain
services, and Bearer tokens echoed from login / `GET /api/v1/auth/me`.

| File | Size | Contents |
|---|---|---|
| `openapi.ts` | 127 KB | Core spec + auth, app-manager, and marketing catalog paths |
| `catalog.ts` | 40 KB | Company, staff, service, item, and contract-price schemas/paths |
| `quotation.ts` | 40 KB | Quotation lifecycle, PDF, work-order creation, internal work-order event |
| `work-orders.ts` | 35 KB | Work Order lifecycle, options, and the Marketing reference endpoints Field Service uses |
| `tax.ts` | 7 KB | Finance tax endpoints + the internal tax event endpoint |
| `audit-trail.ts` | 5.5 KB | App Manager audit trail endpoints |
| `operational-documents.ts` | 3 KB | Quotation and item-size reference endpoints |
| `module-tags.ts` | 4 KB | Maps each path to an OpenAPI tag |

**Path count: 98 path definitions** (135 operations), with **no duplicate path
keys** between files (verified by extracting every path key and grouping by
value). The user directory is not read over the network: Auth owns the users
table, and the directory lookups that other services used to consume have been
removed, so no service reads the user directory any more.

### Security schemes

**VERIFIED** — `openapi.ts:25-31`. Protected operations declare:

```ts
const protectedSecurity = [{ bearerAuth: [] }, { accessTokenCookie: [] }];
```

Internal event endpoints declare `security: []` and instead document their
required headers explicitly — e.g. `x-service-name`, `x-service-secret`, and
the per-flow sync secret (`tax.ts:55`, `quotation.ts:198-200`).

### Coverage by service

| Service | Documented paths | Documented operations |
|---|---|---|
| Auth | 11 | 12 |
| App Manager | 13 | 24 |
| Marketing | 56 | 77 |
| Finance | 4 | 5 |
| Field Service | 8 | 11 |
| Gateway-owned (`/health`, `/services`, `/api-docs`, `/api-docs.json`) | 4 | 4 |
| Internal event endpoints | 2 (counted within the above) | 2 |

**Note — the spec is the gateway's contract, not each service's own route
table.** The gateway documents paths that individual services implement
directly (e.g. `/api/v1/auth/users/{userId}` is a real Auth route), but it is
the single published contract for the platform.

### Hybrid local development in the contract

Paths stay prefixed with `/api/v1/<service>` because that is how clients call
the **gateway**. In hybrid mode the microfrontend instead calls the **local**
service on its `PORT` using the **suffix path only** (what the gateway would
forward after `pathRewrite`), for example `GET http://localhost:5003/companies`
rather than `GET /api/v1/marketing/companies` on the gateway host. Auth
endpoints remain on the deployed gateway (`/api/v1/auth/*`). Environment startup
rules and approved remote hosts are described in OpenAPI `info.description` and
in [`deployment-architecture.md`](./deployment-architecture.md#43-hybrid-local-development-neon--deployed-gateway).

**UNKNOWN** — whether the published contract is intentionally complete was not
established from the repository. The previous `.project-map/api-endpoints.md`
that recorded this was deleted (see [ADR-0007](./adr/ADR-0007-replace-removed-project-map-documentation.md)),
and its route counts were inconsistent across versions.


