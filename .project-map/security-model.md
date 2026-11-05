# Security Model

> Current behavior confirmed in the 2026-11-04 exploration. Paths below are the known source of truth; this file does not re-open them.

## Trust boundaries

```text
Untrusted client
  │ access token + arbitrary headers
  ▼
API Gateway (validates token; strips spoofable identity; adds trusted claims)
  │ x-gateway-secret + verified identity headers + original bearer token
  ▼
Domain service (checks gateway secret; verifies JWT again; checks live profile/permissions)
  │
  └─ internal event endpoint: dedicated sync secret, not user JWT
```

A gateway secret protects a service from direct access. It does **not** replace user authentication or authorization.

## JWT issuance and verification

- **Issuer:** `auth-service`; RS256 access tokens signed with the private RSA key loaded by `auth-service/src/config/accessKey.ts`. Key must be RSA and at least 2048 bits. Private material comes from `JWT_ACCESS_PRIVATE_KEY_BASE64` or `JWT_ACCESS_PRIVATE_KEY_PATH`.
- **JWKS endpoint:** `GET /.well-known/jwks.json` on auth-service, proxied as `/api/v1/auth/.well-known/jwks.json`. Response uses `Cache-Control: public, max-age=300`.
- **Verifiers:** API Gateway and each domain service use `jose` `createRemoteJWKSet` + `jwtVerify` (`src/utils/tokens.ts` per service). Required algorithm is RS256; issuer and audience validated. Gateway requires `sub`, `type === 'access'`, and a valid branch-claim shape.
- **JWKS transport:** gateway fetch includes auth-service's `x-gateway-secret`; domain-service JWKS reads call through the gateway using that service's `x-service-name`/`x-service-secret` credentials.
- **Cache/timeouts:** remote JWKS timeout 5 s; cooldown 30 s; cache max age 10 min.
- **UNKNOWN:** rotation overlap policy and refresh-token revocation policy were not established by the exploration.

## Gateway header trust model

1. Gateway `authenticateServiceCaller` accepts no service headers for a public request; if either internal-service header is supplied, both must be valid. Secrets are compared with `timingSafeEqual` (including length check), then the caller name is stored in `res.locals.serviceCaller`.
2. Proxy removes inbound `x-vercel-id`, `X-User-ID`, `X-User-Role`, `X-User-Name`, `X-User-Email`, `X-User-Username`, `X-Office-Branch-ID`, `X-Service-Name`, `X-Service-Secret`.
3. For `authRequired: true` routes only, `authenticateJwt` verifies the bearer token and populates trusted identity claims; proxy re-adds the relevant identity headers. It always attaches the target's `x-gateway-secret`.
4. For `authRequired: false` internal routes, the gateway does not add user identity; it checks that method is POST and `res.locals.serviceCaller` matches `internalCaller`.
5. Domain services require a matching `x-gateway-secret` on every request (`verifyGatewaySecret`).

Consequences: a client cannot authorize itself by setting `X-User-ID`, branch, or role headers. A valid internal caller credential is also mandatory for internal events.

## Middleware authentication

**Gateway** (`api-gateway/src/app.ts`): helmet → CORS → request ID → logger → cookie parser → `authenticateServiceCaller` → rate limiter → docs/health/services → proxy.

**Typical domain service** (`*/src/app.ts`): helmet → `verifyGatewaySecret` → CORS → request ID → cookie parser → JSON/urlencoded parsers → internal event routers (their own secrets) → health → `authenticate` → business routers → 404 → error handler.

- `auth-service` is different: no global `authenticate`; public login/register/refresh/logout routes exist, while profile and user-management routers apply `authenticate` individually.
- Gateway JWT middleware reads token from Authorization header or cookie (`getAccessToken`), then verifies via JWKS.
- Domain `authenticate` reads the forwarded bearer/cookie token and independently verifies it using the auth JWKS. It does not treat gateway identity headers as a substitute for a valid token.

## Authorization and live-account checks

- Every domain has an `authorize` or `actor` layer that fetches `auth/me` through the gateway with the original bearer token and the domain service's internal gateway credentials.
- Live `id` must match token `sub`; live `isActive`, role, section and branch are evaluated. An inactive user or disallowed section gets 403; identity/token mismatch or stale branch claim gets 401.
- `marketing-service`: `requireMarketingAccess` permits MARKETING section or ADMIN/APP_MANAGER role; `requireQuotationReferenceAccess` additionally permits FINANCE, ACCOUNTING, FIELD_SERVICE. Both require active user and branch.
- `finance-service`: actor establishes `documentActor` and `taxWriteAllowed`; tax reads require branch, writes require `ADMIN` and FINANCE or MARKETING section.
- `fieldservice-service`: actor verifies live user, section, active state and branch; `requireWorkOrderSection` gates lifecycle actions.
- `app-manager-service`: authorization checks current role/section from auth profile.
- `auth-service`: `requireAppManager` protects user-management administration; marketing contacts and field-service inspector lookup remain authenticated, branch-scoped reads.

## Branch ownership enforcement

`officeBranchId` is a tenant boundary, not a display filter.

- Gateway forwards verified token branch claim as `X-Office-Branch-ID` only after successful JWT verification.
- Domain authorization compares that claim to the current branch from `auth/me`. Branch reassignment invalidates the old token and prompts re-login.
- Marketing `getOfficeBranchId(res)` throws 403 if no branch is set (`marketing-service/src/utils/officeBranch.ts`); query and mutation paths scope records to the live branch. Non-admin list visibility also filters inactive records.
- Field Service actor stores branch in `res.locals.workOrderActor`; repositories query branch-scoped records and do not accept a caller-supplied branch as authority.
- Finance actor stores branch in `res.locals.documentActor`; taxes and delivery histories are filtered by that branch.
- User sync and tax/WO events include branch IDs; receivers validate payload branch against snapshot/model branch and reject mismatches.
- Marketing quotation/contract/item reference handlers check company/item/contract branch before returning data.
- **Database limitation:** `auth-service.prisma.User.officeBranchId` is nullable UUID + index, no FK relation to `office_branches`; referential existence is not guaranteed by PostgreSQL. See `database-schema.md` and `decisions.md`.

## Cross-service authentication

### Ordinary internal HTTP calls

Each caller sends:
- `x-service-name: <caller service>`
- `x-service-secret: <caller's GATEWAY_SECRET>`
- For user-scoped calls, `Authorization: Bearer <user access token>`

Gateway validates caller credentials using per-service distinct secrets; proxy adds the target service's `x-gateway-secret`. The receiver validates that secret and independently verifies the user token. Service URL allowlists prevent arbitrary destinations.

### Event calls

Events additionally carry a dedicated secret header, validated at the receiver with `timingSafeEqual`:
- auth → marketing/fieldservice: `x-user-sync-secret`
- finance → marketing: `x-tax-sync-secret`
- fieldservice → marketing: `x-work-order-sync-secret`

The gateway's `internalCaller` guard restricts each event prefix to POST from the configured caller. Receiver validates event shape, branch and version, applies idempotently and returns `{eventId, success:true}`. Delivery workers persist attempts/retry state and use advisory locks to prevent two producer instances from concurrently delivering the same job.

## Configuration-sensitive controls

- Gateway secrets are zod-validated at startup; all configured secrets must be distinct.
- Finance and Field Service are enabled only when service URL and gateway secret are configured together.
- Global rate limiter uses `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX_REQUESTS` (defaults 900000 ms / 100), standard headers enabled; verified service callers are skipped.
- CORS is origin constrained by `CORS_ORIGIN`; the exact production value is deployment config and UNKNOWN here.
- **UNKNOWN:** production WAF, network ACL, TLS termination, secret-rotation cadence and key-rotation runbook.
