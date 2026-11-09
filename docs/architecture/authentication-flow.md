# Authentication Flow

> Token issuance, verification, identity propagation, and where authorization is
> actually enforced.
> Confidence labels are defined in [`README.md`](./README.md#3-confidence-labels).
> Source of truth: `auth-service/src/**`, `api-gateway/src/utils/tokens.ts`,
> and each domain service's `src/utils/tokens.ts` + `src/middlewares/`.

---

## 1. Token inventory

**VERIFIED** — `auth-service/src/utils/tokens.ts` and
`auth-service/src/config/env.ts`.

| Token | Algorithm | Signing key | Lifetime | Storage |
|---|---|---|---|---|
| Access token | **RS256** | RSA private key (`JWT_ACCESS_PRIVATE_KEY_PATH` or `..._BASE64`), `kid` = `JWT_ACCESS_KEY_ID` | `JWT_ACCESS_EXPIRES_IN`, default **15m** | Stateless — sent as `Authorization: Bearer` or the `accessToken` cookie |
| Refresh token | **HS256** | Symmetric `JWT_REFRESH_SECRET` (min 32 chars) | `JWT_REFRESH_EXPIRES_IN`, default **7d** | Persisted in `refresh_tokens`; also set as a cookie |

Both carry `issuer` (`akura-auth`) and `audience` (`akura-api`).

### Access token payload

**VERIFIED** — `auth-service/src/utils/tokens.ts:20-41`:

```ts
{
  name: `${firstName} ${lastName}`.trim(),
  username: user.username,
  role: user.role,           // USER | ADMIN | APP_MANAGER
  section: user.section,     // ACCOUNTING | FINANCE | HRD_MANAGEMENT | MARKETING | FIELD_SERVICE | null
  officeBranchId: user.officeBranchId,
  type: 'access',
  sub: user.id,
  iss, aud, exp, kid
}
```

The `section` claim is present specifically so services can authorise
section-scoped resources without calling back into Auth
(`auth-service/src/utils/tokens.ts:26-28`).

### Refresh token payload

**VERIFIED** — `auth-service/src/utils/tokens.ts:43-51`:
`{ id: uuid, sub: userId, type: 'refresh' }`. The `id` is the database row
identifier, so a refresh token is server-side revocable — it is not a pure
stateless JWT.

---

## 2. Login and token issuance

**VERIFIED** — `auth-service/src/modules/auth/auth.service.ts:52-110`.

```
POST /api/v1/auth/login
  → gateway: globalRateLimiter + authRateLimiter (tighter limit)
  → gateway: authenticateServiceCaller (no-op — no service headers)
  → gateway: proxy to Auth (authRequired: false for this prefix)
  → Auth:   validateBody(loginSchema)
  → Auth:   findUserByUsername
  → Auth:   bcrypt.compare(password, user.password.passwordHash)
  → Auth:   check user.isActive
  → Auth:   issue access + refresh tokens
  → Auth:   persist refresh token row
  → Auth:   write security_audit_logs (LOGIN or LOGIN_FAILED)
  → Auth:   set cookies, return tokens
```

**Failure auditing is deliberate.** A login attempt for an *unknown username*
still writes a `LOGIN_FAILED` audit row, with `detail.reason = 'unknown
username'` — so brute-force attempts are visible
(`auth.service.ts:54-67`). A wrong password writes the row with the user's id
and branch (`auth.service.ts:69-82`).

**Password hashing**: `bcrypt.hash(password, 10)` — cost factor 10
(`auth.service.ts:34`).

### Cookie policy

**VERIFIED** — `auth-service/src/utils/cookies.ts:9-16`.

| Attribute | Development | Deployed (`NODE_ENV=production` or `VERCEL=1`) |
|---|---|---|
| `httpOnly` | `true` | `true` |
| `secure` | `false` | `true` |
| `sameSite` | `lax` | `none` |
| `path` | `/` | `/` |

`sameSite: 'none'` in production is required for cross-site cookie usage with
the frontend, and is safe only because `secure: true` is also set.

Two cookies are set: `accessToken` (max-age = access token lifetime) and
`refreshToken` (max-age = refresh token lifetime).

---

## 3. Token verification

### 3.1 The JWKS endpoint

**VERIFIED** — `auth-service/src/app.ts:41-44` and
`auth-service/src/config/accessKey.ts:24-33`.

```
GET /.well-known/jwks.json
  → { keys: [{ ...publicJwk, kid, use: 'sig', alg: 'RS256' }] }
```

The public key is derived from the private key at startup
(`createPublicKey(accessTokenPrivateKey)`), so the published JWKS always
matches the signing key. `Cache-Control: public, max-age=300`.

**Key constraints enforced at load time** (`accessKey.ts:6-19`):
- Must be an RSA key.
- Modulus length **≥ 2048 bits**.

### 3.2 How consumers verify

**VERIFIED** — `api-gateway/src/utils/tokens.ts` and the identical
`*/src/utils/tokens.ts` in marketing, finance, and fieldservice.

```ts
jwks ??= createRemoteJWKSet(new URL(env.AUTH_JWKS_URL), {
  headers: { 'x-gateway-secret': env.AUTH_SERVICE_GATEWAY_SECRET },
  timeoutDuration: 5_000,
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60 * 1_000,
});

const { payload } = await jwtVerify(token, jwks, {
  algorithms: ['RS256'],
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
});
```

| Property | Value | Purpose |
|---|---|---|
| `algorithms` | `['RS256']` only | Prevents algorithm-confusion attacks |
| `issuer` / `audience` | `akura-auth` / `akura-api` | Scopes the token to this platform |
| `cacheMaxAge` | 10 minutes | Tolerates a JWKS fetch failure without losing verification |
| `cooldownDuration` | 30 seconds | Prevents a JWKS refetch storm on an unknown `kid` |
| `timeoutDuration` | 5 seconds | Bounds the JWKS fetch |

**Every consumer fetches the JWKS *through the gateway*,** using its own
service credentials — the gateway injects the Auth gateway secret. No service
talks to Auth directly, even for key material.

**Additional payload validation** (`api-gateway/src/utils/tokens.ts:22-28`):
`sub` must exist, `type` must be `'access'`, and `officeBranchId` must be
`null` or a string. A refresh token presented as an access token fails this
check because its `type` is `'refresh'`.

### 3.3 Token extraction

**VERIFIED** — `*/src/utils/requestTokens.ts`:

```ts
const authorization = req.headers.authorization;
if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
return req.cookies?.accessToken;
```

The `Authorization` header takes precedence; the cookie is the fallback. This
is why the OpenAPI spec declares both `bearerAuth` and `accessTokenCookie`
security schemes.

---

## 4. Two authorization models

**VERIFIED** — the platform uses two distinct downstream authorization
patterns, and the difference is deliberate.

### 4.1 Model A — full re-validation (marketing, finance, fieldservice)

These services **verify the JWT themselves** and then **call Auth for the live
profile**:

```
verifyGatewaySecret          → 403 if the gateway secret is missing/wrong
authenticate                 → verify RS256 token locally via remote JWKS
authorize / actor            → GET auth/me via the gateway
                              → compare: token.sub == profile.id
                              → compare: token.officeBranchId == profile.officeBranchId
                              → check: profile.isActive
                              → check: profile.role / profile.section
                              → check: gateway X-User-* headers match the token
```

**VERIFIED** — marketing (`src/middlewares/authorize.middleware.ts:15-30`) first
compares the gateway's `X-User-*` headers against the verified token claims; a
mismatch is **401** *"gateway identity does not match access token"*. It then
fetches the live profile and checks `isActive`, section membership, and branch
assignment (`authorize.middleware.ts:40-65`).

**VERIFIED** — finance (`src/middlewares/actor.middleware.ts:13-18`) and
fieldservice (`src/middlewares/actor.middleware.ts:13-16`) perform the same
three-way comparison: token vs. gateway headers vs. live profile.

The branch check is strict. A user whose branch assignment changed while a
token was live gets **401** *"Office branch assignment has changed; please sign
in again"* — the token is not silently accepted.

### 4.2 Model B — header trust (app-manager)

**VERIFIED** — `app-manager-service/src/middlewares/authorize.middleware.ts:28-53`.

App Manager does **not** verify the JWT and has no `jose` dependency. It reads
the identity from the gateway's `X-User-*` headers and validates the role
against the `UserRole` enum. Its justification is documented in the source:

> *"Because the gateway secret already proves the request arrived through the
> gateway, this service does not verify the token itself."*
> — `app-manager-service/src/middlewares/authorize.middleware.ts:31-33`

**Assessment:** this is a deliberate trade-off, not an oversight. The gateway
secret is per-service and unique (the gateway refuses to start if two services
share one), so a caller holding App Manager's secret is the gateway itself.
The trade-off is that App Manager cannot detect a user deactivated *after* the
token was issued — a weaker guarantee than Model A.

### 4.3 Comparison

| | Model A (marketing, finance, fieldservice) | Model B (app-manager) |
|---|---|---|
| Verifies JWT locally | Yes | No |
| Calls Auth for live profile | Yes, every request | No |
| Detects post-issuance deactivation | Yes | No |
| Detects branch reassignment | Yes | No (uses the token's claim only) |
| Requires a live Auth call | Yes | No |
| Gateway secret required | Yes | Yes |

**Both models** additionally require the gateway secret, so neither is
reachable except through the gateway.

---

## 5. Identity propagation

**VERIFIED** — `api-gateway/src/middlewares/auth.middleware.ts:20-28`.

After verification, the gateway writes the token claims into the request
headers, which the proxy then forwards:

| Header | Source claim |
|---|---|
| `X-User-ID` | `sub` (always) |
| `X-User-Role` | `role` (if present) |
| `X-User-Section` | `section` (if present) |
| `X-User-Name` | `name` (if present) |
| `X-User-Username` | `username` (if present) |
| `X-Office-Branch-ID` | `officeBranchId` (if present) |

**These headers are only injected when the route has `authRequired: true`.**
On `authRequired: false` routes (including all four internal event routes),
no identity headers are added — internal calls carry service credentials
instead.

Inbound copies of these headers are always stripped first
(see [`api-gateway-routing.md`](./api-gateway-routing.md#31-headers-stripped-on-every-proxied-request)).

---

## 6. Roles and sections

**VERIFIED** — `auth-service/prisma/schema.prisma` enums.

| Role | Description |
|---|---|
| `USER` | Standard user |
| `ADMIN` | Administrator within a section |
| `APP_MANAGER` | Platform administrator |

| Section | Used by |
|---|---|
| `ACCOUNTING` | Finance read access; quotation reference access |
| `FINANCE` | Finance; tax read/write (with ADMIN) |
| `HRD_MANAGEMENT` | — |
| `MARKETING` | Marketing mutations; Work Order creation; tax write (with ADMIN) |
| `FIELD_SERVICE` | Work Order execution |

**VERIFIED** — `ADMIN` and `APP_MANAGER` bypass section checks in the
authorization middleware (`marketing-service/src/middlewares/authorize.middleware.ts:54`,
`finance-service/src/middlewares/actor.middleware.ts:16`).

**VERIFIED** — Finance tax *writes* are stricter: role `ADMIN` **and** section
`FINANCE` or `MARKETING` (`finance-service/src/middlewares/actor.middleware.ts:18`).

---

## 7. Internal service authentication

**VERIFIED** — three independent layers protect internal calls:

| Layer | Mechanism | Where |
|---|---|---|
| 1. Caller → gateway | `x-service-name` + `x-service-secret`, timing-safe compare | `api-gateway/src/middlewares/serviceCaller.middleware.ts:29-52` |
| 2. Gateway → service | `x-gateway-secret` injected by the proxy, verified by the service | `*/src/middlewares/gateway.middleware.ts` |
| 3. Service → service (events) | A per-flow shared secret in a dedicated header, timing-safe compare | `marketing-service/src/modules/taxes/tax-events.routes.ts`, `.../work-order-events.routes.ts` |

Per-flow secrets:

| Secret | Used by | Minimum length |
|---|---|---|
| `TAX_SYNC_SECRET` | Finance → Marketing | 32 |
| `WORK_ORDER_SYNC_SECRET` | Field Service → Marketing | 32 |

Plus the `internalCaller` route guard (method + caller identity) described in
[`api-gateway-routing.md`](./api-gateway-routing.md#34-internal-route-guards).

**Note on the secret comparison:** the receivers compare with
`timingSafeEqual` *after* a length check (`Buffer.byteLength(supplied) !==
Buffer.byteLength(expected)`), because `timingSafeEqual` throws on
length mismatch. This is the correct pattern.

---

## 8. The gateway is the only entry point

**VERIFIED** - `*/src/middlewares/gateway.middleware.ts`.

Every service refuses a request that does not carry its own gateway secret:

```ts
export const verifyGatewaySecret = (req: Request, res: Response, next: NextFunction): void => {
  if (req.headers['x-gateway-secret'] !== env.GATEWAY_SECRET) {
    res.status(403).json({ status: 403, success: false, message: 'Access denied: requests must pass through the API Gateway', /* ... */ });
    return;
  }
  next();
};
```

The check is **unconditional**. There is no development bypass, no
environment flag that relaxes it, and no loopback exception: a request that
reaches a service directly - from a browser, from a microfrontend, or from any
other client - is rejected with **403**, in development exactly as in
production.

Three consequences follow from the single rule:

| Consequence | Detail |
|---|---|
| **The browser always talks to the gateway** | The gateway is the public edge and owns the origin policy (`CORS_ORIGIN`). A service therefore has no browser origin of its own to allow: its CORS callback accepts any origin, and the gateway decides which origins are served. |
| **The identity headers are always the gateway's** | The gateway rebuilds `X-User-*` from the verified token and strips any the client sent (`proxy.routes.ts:38-63`). Because a request can only arrive through the gateway, a service never reconstructs those headers itself, and a forged `x-user-id` never reaches it. |
| **The service prefixes do not exist** | The gateway strips the `/api/v1/<service>` prefix before proxying, so the services mount their routes at the root only. There is no `/marketing`, `/finance`, or `/fieldservice` mount. |

**The assertion is covered by a test.** A direct call to a running service,
carrying a valid access token but no gateway secret, must be rejected with
403 (`marketing-service/tests/01-functional-baseline.test.ts`).

### 8.1 Hybrid development access

**VERIFIED** - `marketing-service/src/config/env.ts`.

The hosted development environment runs the services on Vercel and the
databases in a Neon development branch, while a developer runs a single
service locally. The local service therefore calls a **deployed** gateway and
a **remote** database, and both are reached over the public internet.

| Requirement | Detail |
|---|---|
| `DEV_ALLOWED_REMOTE_HOSTS` | The development guard refuses any remote host that is not listed by name. The Neon branch host and the deployed gateway host are listed, so the local service may reach them; any other host - a production branch, a production deployment, a typo - is still refused at startup (`env.ts:28-50`). |
| The gateway stays the entry point | The local service is a *callee*, not an edge: the browser keeps calling the deployed gateway, and the deployed gateway calls the deployed services. |
| Bearer token | A cookie set on the deployed gateway's domain never reaches `localhost`. The microfrontend must send `Authorization: Bearer <accessToken>`; the login response returns it in `data.accessToken`, and `GET /api/v1/auth/me` echoes it back so a page reload can restore the session (`auth.controller.ts:46`, `auth.controller.ts:94`). |

**The service credentials still have to match.** A service calls `GET auth/me`
through the deployed gateway with `x-service-secret: <GATEWAY_SECRET>`, and the
gateway compares it against its own `*_GATEWAY_SECRET`. A local secret that
differs from the deployed one produces **403** on that call, which the
authorize middleware surfaces as 401 with the message *Unable to validate the
authenticated user*.

---
## 9. Security observations

### Strengths

| Control | Evidence |
|---|---|
| Algorithm pinning | `algorithms: ['RS256']` in every verifier |
| Issuer + audience validation | Every verifier checks both |
| Refresh tokens are server-side revocable | Persisted in `refresh_tokens`; `logout` and password change revoke them |
| Password change revokes all refresh tokens | `auth.service.ts:288` |
| Timing-safe secret comparison | `timingSafeEqual` throughout, with length pre-checks |
| Per-service unique secrets | The gateway refuses to start if two services share one (`api-gateway/src/config/env.ts:84-90`) |
| Client identity headers always stripped | `proxy.routes.ts:38-46` |
| Brute-force throttling | Two-tier rate limiting; tighter limit on credential endpoints |
| Failed logins audited | Including unknown usernames |
| Key strength enforced | RSA ≥ 2048 bits, checked at load |
| Production CORS locked down | `*` is rejected when `NODE_ENV=production` |
| Development targets forced local | Every service's env schema rejects a remote host in development |

### Risks and gaps

| Item | Severity | Detail |
|---|---|---|
| **App Manager does not verify the JWT** | Medium | Model B above — a deactivated user keeps access until the token expires. See §4.2. |
| **JWT key rotation policy is undefined** | Medium | `accessKey.ts` publishes exactly **one** key. There is no overlap window, no `kid` rotation logic, and no second key support. A rotation would break in-flight tokens. **UNKNOWN** — no rotation policy is documented. |
| **Refresh token rotation / reuse detection** | Medium | `JWT_REFRESH_IDLE_TIMEOUT_MINUTES` (default 60) and refresh revocation on logout/password change are **VERIFIED**. Whether a reused refresh token is detected and the family revoked is **UNKNOWN** — not established from the code reviewed. |
| **No TLS termination in-app** | Medium | The gateway trusts `X-Forwarded-For` only on Vercel. TLS is terminated by the platform — **UNKNOWN** which. |
| **Long-lived internal secrets** | Low | Per-service gateway secrets and sync secrets are static environment values with no rotation mechanism in-app. |
| **Bearer token in `Authorization` header** | Low | Standard practice; the cookie fallback means the token is also in a cookie. Both are accepted. |
| **No security headers beyond `helmet()` defaults** | Low | No explicit CSP, since the gateway serves only JSON and Swagger UI. |
