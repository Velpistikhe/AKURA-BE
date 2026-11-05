# ADR-0001: Gateway as the Single Entry Point

**Status:** Accepted (reconstructed)
**Date:** Undated — reconstructed from source at commit `ec4484c`

---

## Context

Six independently deployable services need to expose a single, coherent API to
browser clients. Deploying each service as its own public endpoint would
create several problems:

- Authentication logic would be duplicated in every service.
- Clients would need to know the address of every service.
- Per-service authorisation (role, section, office branch) would be
  inconsistent.
- Rate limiting would be applied per service, so a client could spread an
  attack across them.
- Cross-origin rules would have to be configured in six places.

## Decision

**The API Gateway is the only public entry point.** Every other service is
reachable only through it, and enforces that with a shared secret.

The mechanism has three parts:

1. **The gateway strips inbound identity headers** and re-injects its own
   after verifying the JWT, so a client can never assert its own identity.
2. **Each service verifies the gateway secret** on every request and returns
   403 if it is missing or wrong.
3. **Outbound service calls are built against `API_GATEWAY_URL`**, with a
   per-service path allowlist, so no service holds another service's address.

### The three parts in detail

**Header stripping** — `api-gateway/src/routes/proxy.routes.ts:32-46` removes
`X-User-ID`, `X-User-Role`, `X-User-Section`, `X-User-Name`, `X-User-Email`,
`X-User-Username`, `X-Office-Branch-ID`, `X-Service-Name`, `X-Service-Secret`,
and `x-vercel-id` before forwarding. The gateway then re-adds the identity
headers from the verified token, and only on routes where `authRequired: true`.

**The gateway secret** — every domain service has
`src/middlewares/gateway.middleware.ts` that compares `x-gateway-secret`
against `env.GATEWAY_SECRET` and returns 403 with *"Access denied: requests
must pass through the API Gateway"*.

**The path allowlist** — each service's `src/utils/serviceUrl.ts` validates
the target path against a per-service prefix regex and rejects `..` and `://`:

| Service | Allowed prefixes |
|---|---|
| auth | `auth`, `marketing`, `fieldservice` |
| marketing | `auth`, `marketing`, `fieldservice`, `finance` |
| finance | `auth`, `marketing`, `finance`, `fieldservice` |
| fieldservice | `auth`, `marketing`, `finance` |
| app-manager | *(no outbound calls)* |

## Consequences

**Positive**

- One place to enforce JWT verification, rate limiting, CORS, and correlation
  IDs.
- One public origin, so CORS and cookie policy are configured once.
- Services can be moved to a different host without touching callers.
- The gateway secret provides a defence in depth that is independent of JWT
  validity — even a valid token cannot reach a service directly.

**Negative**

- **The gateway is a single point of failure and a latency hop** on every
  request, including internal service-to-service calls.
- **Every request requires a gateway round trip**, even when the caller is
  another service. This is unusual for microservices and adds measurable
  latency.
- **The gateway must scale for all traffic**, not just edge traffic, since
  internal traffic passes through it too.
- **Debugging crosses a process boundary**, which is why `x-request-id` is
  propagated on every hop.

**Neutral**

- Because the gateway secret is per-service and the gateway refuses to start
  if two secrets are equal, a service's secret cannot be used to impersonate
  another service.

## Evidence

| Claim | Location |
|---|---|
| Header stripping and re-injection | `api-gateway/src/routes/proxy.routes.ts:32-46` |
| Gateway secret verification | `*/src/middlewares/gateway.middleware.ts` |
| Path allowlists | `*/src/utils/serviceUrl.ts` |
| Unique-secret startup check | `api-gateway/src/config/env.ts:84-90` |
| Internal route `POST`-only + caller guard | `api-gateway/src/routes/proxy.routes.ts:10-18` |
| Proxy failure returns 503 | `api-gateway/src/routes/proxy.routes.ts:65-77` |

## Related

- [ADR-0005](./ADR-0005-layered-service-credentials.md) — how service identity is layered on top of this
- [`../api-gateway-routing.md`](../api-gateway-routing.md) — the full routing table
