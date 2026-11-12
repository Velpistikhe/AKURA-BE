# ADR-0005: Layered Service Credentials

**Status:** Accepted (reconstructed)
**Date:** Undated — reconstructed from source at commit `ec4484c`

---

## Context

[ADR-0001](./ADR-0001-gateway-as-single-entrypoint.md) established that all
traffic passes through the gateway. But routing through the gateway is not the
same as *authenticating* the caller. The gateway must be able to tell three
things apart:

1. A **browser client** presenting a user token.
2. **Another service** making an internal call.
3. An **attacker** trying to reach a service directly or to impersonate a
   service.

A single shared secret cannot cleanly express this. And for events, a service
authenticating to the gateway is not the same as the gateway authenticating to
the receiver — the receiver needs to know *which* service sent the event, so it
can apply the right secret.

## Decision

**Use three independent layers, each with its own secret, plus per-flow secrets
for events.**

### Layer 1 — caller → gateway

**VERIFIED** — `api-gateway/src/middlewares/serviceCaller.middleware.ts`:

- If **neither** `x-service-name` nor `x-service-secret` is present → treat as
  a normal client request.
- If **either** is present → the secret is looked up by service name and
  compared with `timingSafeEqual`. Unknown name, missing secret, or mismatch →
  **403**.

**Layer 2 — gateway → service**

The proxy injects `x-gateway-secret` (the target service's own secret) on
every proxied request. Each service verifies it in
`src/middlewares/gateway.middleware.ts` and returns **403** otherwise.

**Layer 3 — service → service, for events**

Each event flow has its **own** shared secret in a dedicated header, checked by
the receiver with `timingSafeEqual`:

| Secret | Flow | Minimum length |
|---|---|---|
| `TAX_SYNC_SECRET` | Finance → Marketing | 32 |
| `WORK_ORDER_SYNC_SECRET` | Field Service → Marketing | 32 |

**Plus a route-level guard.** In the gateway's routing table, each internal
route declares an `internalCaller`. A request to such a route must use
`POST` **and** present the credentials of that specific service:

`api-gateway/src/routes/proxy.routes.ts:10-18` → otherwise **403** with
`"<service> credentials are required"`.

### Two supporting rules

**Secrets must be unique per service.** The gateway refuses to start if two
services share a secret (`api-gateway/src/config/env.ts:84-90`). This is what
makes "the holder of this secret is the gateway" a sound inference.

**Comparison is timing-safe.** Every secret comparison uses `timingSafeEqual`,
guarded by a byte-length pre-check — necessary because `timingSafeEqual`
throws on a length mismatch, which would otherwise surface as a 500 instead of
a clean 403.

### Two authorization models downstream

A consequence of this layering is that downstream services do **not** all
authorize identically:

| Model | Services | Behaviour |
|---|---|---|
| **A — full re-validation** | marketing, finance, fieldservice | Verify the JWT locally, then call `GET auth/me` and compare the live profile against both the token and the gateway headers |
| **B — header trust** | app-manager | Does not verify the JWT; trusts the gateway's `X-User-*` headers, justified by the gateway-secret check |

App Manager's justification is in the source:

> *"Because the gateway secret already proves the request arrived through the
> gateway, this service does not verify the token itself."*
> — `app-manager-service/src/middlewares/authorize.middleware.ts:31-33`

## Consequences

**Positive**

- **Defence in depth.** A forged header, a stolen user token, and a direct
  connection to a service are each blocked by a different layer.
- **Per-flow secrets limit blast radius.** Compromising the tax sync secret
  does not grant access to the work-order callback path.
- **Timing-safe comparison** removes the timing side channel from secret
  verification.
- **Startup validation prevents secret reuse**, which is a common and
  hard-to-spot misconfiguration.
- **The internal route guard** distinguishes "a valid service" from "the
  right service for this endpoint".

**Negative**

- **Nine secrets to configure** (5 gateway + 3 sync + 1 refresh), and each
  sync secret must match across two or three services. A mismatch produces a
  403 at runtime, not at startup.
- **No rotation mechanism.** All secrets are static environment values. A
  rotation requires coordinated redeployment of several services.
- **Model B (App Manager) is weaker.** It cannot detect a user deactivated
  after the token was issued; it trusts the token's `role` claim until the
  token expires (≤ 15 minutes).
- **The `x-gateway-secret` is a bearer secret.** It travels on every internal
  request and is only as safe as the network between the services.
- **Layer 3 duplicates layer 2 for event routes.** The gateway already
  authenticates the caller; the receiver re-authenticates with a different
  secret. This is intentional — the receiver's trust does not depend on the
  gateway's own integrity — but it does mean two secrets per event flow.

## Open issue

**Model B should be reviewed.** The asymmetry between App Manager and the
other three services is a security-relevant inconsistency. Making App Manager
use Model A would cost one extra call to Auth per request but would close the
gap. Recorded here as an open question rather than a decision.

## Evidence

| Claim | Location |
|---|---|
| Service caller authentication | `api-gateway/src/middlewares/serviceCaller.middleware.ts:15-52` |
| Unique-secret startup check | `api-gateway/src/config/env.ts:84-90` |
| Gateway secret injection | `api-gateway/src/routes/proxy.routes.ts:32-46` |
| Per-service gateway secret check | `*/src/middlewares/gateway.middleware.ts` |
| `internalCaller` route guard | `api-gateway/src/routes/proxy.routes.ts:10-18` |
| Event secret verification | `marketing-service/src/modules/taxes/tax-events.routes.ts`, `.../work-order-link.routes.ts` |
| Model A vs Model B | `marketing-service/src/middlewares/authorize.middleware.ts` vs `app-manager-service/src/middlewares/authorize.middleware.ts:28-53` |
| Sync secret minimum length | `*/src/config/env.ts` |

## Related

- [ADR-0001](./ADR-0001-gateway-as-single-entrypoint.md) — the gateway boundary this layers on top of
- [ADR-0004](./ADR-0004-rs256-jwt-with-remote-jwks.md) — user-token verification
- [`../authentication-flow.md`](../authentication-flow.md) — §7 covers the three layers in detail

