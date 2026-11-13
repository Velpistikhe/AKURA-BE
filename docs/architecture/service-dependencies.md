# Service Dependencies

> Who depends on whom, in which direction, through which channel, and how
> tightly. Companion to [`service-catalog.md`](./service-catalog.md) (what each
> service is) and [`integration-and-event-flow.md`](./integration-and-event-flow.md)
> (how the calls work).
> Confidence labels are defined in [`README.md`](./README.md#3-confidence-labels).

---

## 1. Dependency matrix

**VERIFIED** — built by searching every service's `src/` for outbound call
sites (`fetch(`, `serviceUrl(`, `gatewayGet(`) and by reading each call site.

Legend: **●** = hard runtime dependency · **—** = none

| Caller ↓ / Callee → | api-gateway | auth | app-manager | marketing | finance | fieldservice |
|---|---|---|---|---|---|---|
| **api-gateway** | — | ● | ● | ● | ● | ● |
| **auth** | ● | — | — | — | — | — |
| **app-manager** | — | ● | — | — | — | — |
| **marketing** | ● | ● | — | — | — | — |
| **finance** | ● | ● | — | — | — | — |
| **fieldservice** | ● | ● | — | ● | — | — |

**Every non-gateway row points at the gateway**, never directly at a peer.
That is the platform's central invariant. The gateway row points outward at
all five domain services.

### Reading the matrix

- **fieldservice → marketing**: synchronous quotation/contract/item reference
  reads, plus the asynchronous Work Order link-state callback.
- **finance → marketing**: asynchronous tax snapshot delivery.
- **marketing, finance, fieldservice → auth**: synchronous live-profile reads
  (`GET auth/me`), plus JWKS reads.
- **app-manager → auth**: synchronous live-profile read (`GET auth/me`) when a
  request arrives without the gateway's identity headers, i.e. on a direct
  local call in hybrid development.

---

## 2. Dependency detail

### 2.1 api-gateway → all domain services

**VERIFIED** — `api-gateway/src/config/services.config.ts`.

The gateway holds one target URL and one secret per service, and proxies
`/api/v1/*` accordingly. Every proxied request carries `x-gateway-secret`.
This is the only dependency in the platform that is *not* routed back through
the gateway itself.

### 2.2 auth: no outbound calls

**VERIFIED** — Auth makes no outbound service call. It used to push user
snapshots to Marketing and Field Service through an outbox; that replication is
gone. Auth now only serves the profile and the directory, and the consumers
*pull* what they need.

### 2.3 fieldservice → marketing (quotation basis and link callback)

**VERIFIED** — `fieldservice-service/src/integrations/gateway.ts` (reads) and
`fieldservice-service/src/modules/work-orders/work-order-link-delivery.ts` (async link).

| Direction | Call | Purpose |
|---|---|---|
| Field Service → Marketing | `GET marketing/quotation-references/:id` | Live quotation basis for a Work Order |
| Field Service → Marketing | `GET marketing/contract-references/:id` | Live contract basis |
| Field Service → Marketing | `GET marketing/item-size-references/:id` | Catalog identity for an item size |
| Field Service → Marketing | `POST marketing/internal/quotations/:id/work-order` | Async quotation link mirror (outbox) |

Quotation-based Work Order writes enqueue a link event in the Field Service
database (`work_order_link_events` / `work_order_link_deliveries`) in the same
transaction as the Work Order row. A worker (and an in-request bounded batch)
delivers `POST marketing/internal/quotations/{quotationId}/work-order` with
`x-work-order-sync-secret`. The client's HTTP response succeeds when the Work
Order commits; Marketing's `hasWorkOrder` / `workOrderSnapshot` update is
**eventually consistent**, with idempotent retries on failure.

### 2.4 finance → marketing (async)

**VERIFIED** — `finance-service/src/modules/taxes/tax-delivery.ts`.

Finance owns the authoritative `taxes` table and delivers versioned snapshots
to Marketing's `tax_cache` read model via `POST marketing/internal/taxes/events`
with `x-tax-sync-secret`.

Delivery targets are validated to point at the configured gateway URL
(`tax-delivery.ts:22`), so a tax snapshot cannot bypass the edge.

### 2.5 marketing / finance / fieldservice → auth (sync)

**VERIFIED** — `GET auth/me` via the gateway, from:

| Caller | File |
|---|---|
| marketing | `src/middlewares/authorize.middleware.ts:33` |
| finance | `src/middlewares/actor.middleware.ts:10` |
| fieldservice | `src/middlewares/actor.middleware.ts:10` |

Plus JWKS reads from marketing, finance, and fieldservice
(`*/src/utils/tokens.ts:11`), and the inspector lookup
`GET auth/users/field-service/inspectors` from Field Service
(`src/integrations/gateway.ts:224`).

This is the **live profile check**: it catches a user whose account was
deactivated, whose branch assignment changed, or whose section changed since
the token was issued.

### 2.6 app-manager → auth (live profile check)

**VERIFIED** — `app-manager-service/src/middlewares/authorize.middleware.ts`
resolves the caller with `GET {API_GATEWAY_URL}/api/v1/auth/me` when a request
arrives without the gateway's `X-User-*` headers, which is the case for a
direct local call in hybrid development. The call goes through the gateway, so
App Manager holds no other service's address.

App Manager is otherwise a leaf: it exposes reference data and an audit-trail
API and depends on nobody else.

---

## 3. Coupling characteristics

### 3.1 Where coupling is concentrated

| Coupling | Strength | Where |
|---|---|---|
| Gateway ↔ every service | **High** | Every request, every event |
| Field Service → Marketing | **High** | Shared quotation/work-order semantics and a shared secret |
| Everything → Auth | **Medium** | Every authorisation decision performs a live profile read |
| Auth → Marketing/Field Service | **Low-Medium** | Async, eventually consistent read models |
| Finance → Marketing | **Low-Medium** | Async, eventually consistent read model |
| App Manager → anything | **None** | Leaf |

### 3.2 The eventual-consistency seam

**VERIFIED** — one read model is replicated rather than joined:

| Read model | Source of truth | Replication |
|---|---|---|
| `tax_cache` | `finance.taxes` | Finance outbox → Marketing |

The user directory has no read model. Auth is the source of truth and the
consumers read it live, so there is no seam to be eventually consistent
across.

Each carries a version marker so a stale or replayed event is ignored:
`tax_cache_revisions`.

**Consequence:** a read model can be temporarily behind its source. Only the
tax cache is a read model now. The user directory has no replica at all, and
no service reads it over the network any more: the directory lookups have
been removed, so the inspector names and the quotation contacts are entered
by the client instead.

### 3.3 Circular dependencies

**VERIFIED** — no cycle exists any more.

```
Field Service  ──(POST work-order link)──▶  Marketing
```

The Work Order is **not** created through Marketing. The client creates it
directly on Field Service (`POST /api/v1/fieldservice/work-orders/from-quotation`),
and Field Service resolves the quotation through the Marketing quotation
reference and notifies Marketing of the new link. The callback is synchronous
and idempotent, and Marketing mirrors the link on its own quotation row, so no
return leg to Field Service is needed. See
[ADR-0003](./adr/ADR-0003-http-outbox-over-message-broker.md) for why an outbox
was chosen over a broker on the asynchronous legs.

### 3.4 Fan-in and fan-out

| Service | Fan-out (calls it makes) | Fan-in (called by) |
|---|---|---|
| api-gateway | 5 | 6 (all others, for outbound calls) |
| auth | 0 | 5 |
| marketing | 2 | 2 (gateway, auth) |
| fieldservice | 5 | 2 (gateway, auth) |
| finance | 2 | 2 (gateway, marketing via tax delivery) |
| app-manager | 1 (auth) | 1 (gateway only) |

---

## 4. Adding a dependency — the established pattern

**VERIFIED** — the pattern is identical in all five domain services. To add a
call from service A to service B:

1. **Extend A's path allowlist** in `A/src/utils/serviceUrl.ts`. The regex
   must admit the target prefix. This is a deliberate allowlist, not a free
   string.
2. **Call `serviceUrl('<prefix>/<path>')`** — never build a URL by hand. This
   guarantees the call goes through the gateway.
3. **Attach `serviceHeaders(path)`** — supplies `x-service-name` and
   `x-service-secret` so the gateway's `authenticateServiceCaller` accepts the
   request.
4. **For user-facing calls, forward the Bearer token** so the gateway can
   authorise the request on B's behalf. For internal calls, forward the
   service credentials instead.
5. **Handle upstream failure explicitly.** The codebase convention is to map
   4xx upstream statuses through and convert everything else to `503` — see
   `fieldservice-service/src/integrations/gateway.ts:22-33`.
6. **Never call a service directly.** A direct URL would bypass the gateway
   secret, the gateway's JWT verification, and the identity headers.

---

## 5. Dependency risks

| Risk | Impact | Mitigation in place |
|---|---|---|
| Field Service → Marketing callback | A Marketing outage rolls the Field Service write back | Fail-closed `503`s, idempotent receiver, transaction rollback |
| Auth is on every authorisation path | Auth degradation blocks all writes | Local JWKS cache (~10 min) lets services keep verifying tokens |
| Eventual consistency in read models | Stale tax data | Version guards on the tax cache; the user directory is read live, so it is never stale |
| **No broker** → delivery depends on a reachable gateway | An outage delays sync until retry | Outbox persistence, exponential backoff, in-request batch fallback |
| **Conditional routing** → a service can be absent | 404 instead of a clear error | `servicesConfig` only registers a service when URL + secret are both set — but nothing alerts on the omission |
| No shared library | Fixes must be replicated across 6 packages | Documented conventions; `npm run typecheck` per service |

