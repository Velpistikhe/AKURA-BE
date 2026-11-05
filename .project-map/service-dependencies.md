# Service Dependencies

> Derived from the 2026-11-04 exploration pass. No re-scan was performed for this file.
> All six services are independently deployable; the API Gateway is the only public edge.

## Topology

```
Client
  │
  ▼
api-gateway  ── public edge: proxy, JWT guard, rate limit, Swagger
  │
  ├── /api/v1/auth              → auth-service
  ├── /api/v1/app-manager       → app-manager-service
  ├── /api/v1/marketing         → marketing-service
  ├── /api/v1/finance           → finance-service      (conditional)
  ├── /api/v1/fieldservice      → fieldservice-service (conditional)
  │
  └── /api/v1/*/internal/*      → internal event routes (POST only, authRequired:false)
```

**Rule:** no service holds another service's direct URL. Every hop — user-facing and service-to-service — is relayed by the gateway.

Routing table: `api-gateway/src/config/services.config.ts`
Proxy: `api-gateway/src/routes/proxy.routes.ts`

## HTTP communication (synchronous, request-scoped)

Calls are built by `src/utils/serviceUrl.ts` in each service: requires `API_GATEWAY_URL`, rejects `..` and `://`, and enforces a per-service prefix allowlist.

| Caller | Allowed prefixes | Typical target |
|---|---|---|
| auth-service | `auth`, `marketing`, `fieldservice` | user sync POST |
| app-manager-service | `auth`, `marketing` | `auth/me` profile |
| marketing-service | `auth`, `marketing`, `fieldservice`, `finance` | `auth/me`, WO lookup |
| fieldservice-service | `auth`, `marketing`, `finance` | `auth/me`, quotation refs |
| finance-service | `auth`, `marketing`, `finance`, `fieldservice` | `auth/me` |

Confirmed synchronous flows:

| From | To | Path | Purpose |
|---|---|---|---|
| fieldservice | marketing | `marketing/quotation-references/:id` | quotation header + items for a Work Order |
| fieldservice | marketing | `marketing/contract-references/:id` | approved contract snapshot |
| fieldservice | marketing | `marketing/item-size-references/:id` | catalog identity for contract-basis items |
| marketing | fieldservice | `fieldservice/work-orders/by-quotation/:id` | live WO check before a quotation revision |
| marketing | fieldservice | `DELETE fieldservice/work-orders/:id` | revoke compensation |
| marketing | auth | `auth/me` | live profile in `authorize` middleware |
| app-manager | auth | `auth/me` | live profile in `authorize` middleware |
| fieldservice | auth | `auth/me` | live profile in `actor` middleware |
| finance | auth | `auth/me` | live profile in `actor` middleware |

Key implementations:
- `marketing-service/src/modules/quotations/work-order.integration.ts`
- `fieldservice-service/src/integrations/gateway.ts` (`gatewayGet`)
- `*/src/middlewares/authorize.middleware.ts`, `*/src/middlewares/actor.middleware.ts`

Fail-closed contract: a WO check that cannot reach Field Service returns **503**, never a silent `false`. Upstream 400/401/403/404/409 are passed through; other upstream statuses collapse to 503 (`work-order.integration.ts`).

Payload projection: `toQuotationSnapshot` / `toContractSnapshot` use explicit key allowlists so no price or stray column can reach a `jsonb` snapshot column.

## Event communication (asynchronous, retried, idempotent)

Always `POST`, always via the gateway, always with a dedicated sync secret.

| Producer | Consumer | Gateway prefix | Secret header |
|---|---|---|---|
| auth-service | marketing-service | `/api/v1/marketing/internal/users/events` | `x-user-sync-secret` |
| auth-service | fieldservice-service | `/api/v1/fieldservice/internal/users/events` | `x-user-sync-secret` |
| finance-service | marketing-service | `/api/v1/marketing/internal/taxes/events` | `x-tax-sync-secret` |
| fieldservice-service | marketing-service | `/api/v1/marketing/internal/work-orders/events` | `x-work-order-sync-secret` |

Secret ownership:

| Secret | Producer | Consumer |
|---|---|---|
| `GATEWAY_SECRET` | all six | gateway (`authenticateServiceCaller`) |
| `USER_SYNC_SECRET` | auth | marketing, fieldservice |
| `TAX_SYNC_SECRET` | finance | marketing |
| `WORK_ORDER_SYNC_SECRET` | fieldservice | marketing |

Shared mechanics across all three flows:

- **Single-writer guarantee** — `pg_try_advisory_xact_lock(hashtext(id))` inside a `prisma.$transaction`; a second instance finds the lock held and skips.
- **Backoff** — `min(300000, 10000 * 2 ** min(attempt-1, 5))` ms plus `0-999` ms jitter.
- **Idempotency** — receiver-side `version` guard; an event at or below the stored version is acknowledged without re-applying.
- **Acknowledgement** — `{ eventId, success: true }` must echo the sent `eventId` or the delivery is treated as failed.
- **Timeouts** — 10 s per attempt, transaction `timeout: 20000`, `maxWait: 5000`.

Producers: `auth-service/src/modules/user-sync/user-sync.delivery.ts`, `finance-service/src/modules/taxes/tax-delivery.ts`, `fieldservice-service/src/integrations/gateway.ts`
Receivers: `marketing-service/src/modules/{user-sync,taxes}/…`, `marketing-service/src/modules/quotations/work-order-events.routes.ts`, `fieldservice-service/src/modules/user-sync/user-sync.routes.ts`

Gateway-side guard: an `internalCaller` route accepts only `POST` from that named caller (`api-gateway/src/routes/proxy.routes.ts`), and `authenticateServiceCaller` matches `x-service-name`/`x-service-secret` with `timingSafeEqual` (`api-gateway/src/middlewares/serviceCaller.middleware.ts`).

## Authentication flow

1. Client logs in → `auth-service` issues an RS256 access token (private key from `JWT_ACCESS_PRIVATE_KEY_PATH`, RSA ≥ 2048 bits enforced at load) and a refresh token.
2. Client calls the gateway with the access token (header or cookie).
3. Gateway `authenticateJwt` verifies it against the JWKS at `auth-service /.well-known/jwks.json` (`algorithms: ['RS256']`, issuer, audience, `type === 'access'`).
4. Gateway **strips** inbound identity headers, then re-adds `X-User-*` / `X-Office-Branch-ID` only after verification succeeds and only when that route has `authRequired: true`.
5. Gateway attaches `x-gateway-secret` for the target service.
6. Domain service runs `verifyGatewaySecret` → `authenticate` (local RS256 verify) → `authorize`/`actor`, which calls `auth/me` and cross-checks the live profile against both the token and the gateway headers.
7. Divergence between gateway headers and token raises **401**; inactive account or missing section raises **403**; changed branch raises **401** and forces re-login.

## Dependency direction

```
                 ┌─────────────┐
                 │ auth-service │  ← root of trust (signs tokens, publishes JWKS)
                 └─────────────┘
                        ▲
        ┌───────────────┼────────────────┐
        │               │                │
app-manager        marketing ──────► fieldservice
                        ▲                │
                        │                │
                     finance ────────────┘  (fieldservice also reads marketing)
```

- **No cycles** among the domain services for synchronous calls: marketing ↔ fieldservice is the only bidirectional pair, and both directions are reference lookups, not shared writes.
- Every domain service depends on **auth-service** for profile/JWKS. auth-service depends on **no** domain service synchronously.
- **marketing-service** is the hub: it receives three of the four event flows and serves the reference data fieldservice needs.
- **fieldservice-service** is the only service that both *consumes* marketing references and *produces* events marketing consumes.
- **app-manager-service** is a leaf: it reads `auth/me` and writes only its own menu/office-branch tables.

## Conditional availability

`finance-service` and `fieldservice-service` routes register only when **both** `*_SERVICE_URL` and `*_SERVICE_GATEWAY_SECRET` are set (`api-gateway/src/config/services.config.ts`). Half-configuration fails gateway startup (`api-gateway/src/config/env.ts`). All five gateway secrets must be distinct.
