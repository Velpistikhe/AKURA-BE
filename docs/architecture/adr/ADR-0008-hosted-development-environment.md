# ADR-0008: Hosted Development Environment

**Status:** Accepted (reconstructed)
**Date:** Undated - reconstructed from source

---

## Context

The platform was originally developed with every service running on the local
machine: six Node processes plus six local PostgreSQL databases. That topology
is expensive to keep running on a developer laptop, and it drifts: the local
database contents, the seeded users, and the deployed services are different
systems, so a bug that reproduces locally does not necessarily reproduce on
the deployed environment.

The alternative is to host the whole development environment: the services run
on Vercel and the databases live in a Neon **development branch**. A developer
then runs a single service locally - usually the one being worked on - and
points it at the hosted gateway and the hosted database.

Two properties of the existing configuration made this a real change rather
than a configuration edit:

1. **The development guard forbids remote targets.** Every service validates
   its environment with `zod` and refuses to start when a development
   configuration points at a non-local host (`assertLocalTarget` in
   `*/src/config/env.ts`). The guard exists so a local run cannot modify real
   data by accident.
2. **Inter-service calls always pass through the gateway.** A service builds
   every outbound URL from `API_GATEWAY_URL` and a path allowlist
   (`*/src/utils/serviceUrl.ts`), so there is no direct service-to-service
   address to point at a deployed instance.

## Decision

**Keep the development guard, and let it accept an approved remote target.**

The guard is `assertAllowedTarget`. What counts as approved depends on the
service:

| Service | Approved remote hosts | Mechanism |
|---|---|---|
| App Manager, Marketing, Finance, Field Service | The Neon development branch (`*.neon.tech`) and the deployed API Gateway (`akura-api-gateway.vercel.app`) | A fixed policy in `isApprovedDevelopmentHost`; no environment variable |
| API Gateway, Auth Service | Only a host the operator names explicitly | `DEV_ALLOWED_REMOTE_HOSTS`, a comma-separated list of host names |

| Rule | Effect |
|---|---|
| The local machine is always allowed | `localhost`, `127.0.0.1`, `::1`, `0.0.0.0` need no declaration |
| A remote host is allowed only when approved | The four domain services approve the hosted development targets by policy; the Gateway and Auth Service require the host to be listed |
| The list is literal, never a wildcard | A `*` entry does not match anything; naming one host does not open another |
| The guard applies only in development | Outside development the guard is skipped entirely |
| Every guarded target is covered | `DATABASE_URL`, `API_GATEWAY_URL`, `AWS_ENDPOINT_URL_S3`, `TAX_DELIVERY_TARGETS[]`, and the gateway's `*_SERVICE_URL` / `AUTH_JWKS_URL` |

**The allowlist is per host, not per environment.** A Neon development
branch has its own host, and a deployed service has its own host, so the
approval that unlocks the development environment does not unlock production.
A production branch, a production deployment, or a typo in a hostname is
still refused at startup.

**The domain services do not need a per-machine list.** The four domain
services are the ones a developer runs locally, and their hosted targets are
known in advance: the shared Neon development branch and the deployed
Gateway. Approving them by policy removes a variable that every developer
would otherwise have to fill in and keep in step with the deployment, and it
removes the risk of a stale list that silently blocks a legitimate run. The
Gateway and Auth Service keep the explicit list, because their outbound
targets are the other services, whose deployed host names are not fixed.

**The gateway stays the auth and integration entry point.** Login, refresh,
JWKS, and inter-service calls use the deployed gateway. On **production** and
**Vercel**, every service requires the gateway secret on every request.

**Hybrid local runs** add a narrow exception for App Manager, Marketing,
Finance, and Field Service on the developer machine: public routes accept a
Bearer token without `x-gateway-secret`; `/internal/*` stays gateway-only
(see ADR-0001 and `authentication-flow.md` §8). Auth Service never uses that
exception.

## Consequences

**Positive**

- **One running service is enough.** The developer starts the service under
  work and points it at the hosted gateway and the shared Neon branch.
- **The environment is shared.** The deployed gateway, the deployed Auth, and
  the Neon branch behave like the environment the developer is testing against,
  so a defect is reproducible instead of being an artefact of local state.
- **The guard survives.** A run that reaches for an unapproved host still fails
  to start, with a message that names the host it refused.
- **Production paths stay strict.** Deployed services and Auth still require
  the gateway secret; the local-direct exception exists only for the four
  domain services in non-Vercel development.
- **The rule is auditable.** For the Gateway and Auth Service the allowlist is
  a configuration value in the same place as every other environment value, so
  what a run may reach is visible in review. For the four domain services the
  approved hosts are a short, fixed list in the source next to the guard.

**Negative**

- **A run now depends on the network.** A local service calls a remote
  database and a remote gateway, so latency and availability enter the local
  development loop.
- **The credential must be shared.** The local service presents its
  `GATEWAY_SECRET` to the deployed gateway, which compares it against its
  own `*_GATEWAY_SECRET`. A mismatch produces a 403 on the internal call,
  which the caller reports as 401.
- **The browser cannot rely on cookies.** A cookie set on the deployed
  gateway's domain never reaches `localhost`, so the microfrontend must
  carry the access token as a bearer token.
- **Two URLs in hybrid mode.** The microfrontend uses the deployed gateway for
  auth and `localhost:5002`–`5005` for module APIs. Misconfigured client env
  (wrong base URL or missing Bearer header) shows up as 401/403 on the local
  port.
- **The trust boundary widens.** A developer machine now holds a credential
  that the deployed environment accepts. The secret is development-only, and
  the deployed environment is the development environment, but the credential
  is no longer confined to one machine.
- **The domain services approve a host pattern, not a host name.** Any Neon
  host ending in `.neon.tech` passes the guard, so a branch that is not the
  shared development branch is reachable without a second approval step. The
  pattern is intentionally broad because the branch host name changes when a
  branch is recreated; the cost is that the guard cannot tell one development
  branch from another.

## Evidence

| Claim | Location |
|---|---|
| The development guard | `*/src/config/env.ts` |
| The fixed approval policy of the domain services | `app-manager-service/src/config/env.ts`, `marketing-service/src/config/env.ts`, `finance-service/src/config/env.ts`, `fieldservice-service/src/config/env.ts` (`isApprovedDevelopmentHost`, `assertAllowedTarget`) |
| The remote host allowlist of the Gateway and Auth Service | `api-gateway/src/config/env.ts`, `auth-service/src/config/env.ts` (`parseAllowedRemoteHosts`, `assertAllowedTarget`) |
| Gateway secret + local direct access | `*/src/middlewares/gateway.middleware.ts`, `*/src/utils/localDirectAccess.ts` |
| Outbound URL construction | `*/src/utils/serviceUrl.ts` |
| The token returned to the microfrontend | `auth-service/src/modules/auth/auth.controller.ts` |
| The direct request is refused | `marketing-service/tests/01-functional-baseline.test.ts` |
| The test harness stays local | `marketing-service/tests/support/processes.ts`, `.../harness.ts` |
| The environment rules are asserted | `marketing-service/tests/09-environment.test.ts` |

## Related

- [ADR-0001](./ADR-0001-gateway-as-single-entrypoint.md) - the gateway boundary
  this development topology reuses
- [ADR-0004](./ADR-0004-rs256-jwt-with-remote-jwks.md) - why the token must be
  carried as a bearer token in hybrid access
- [`../authentication-flow.md`](../authentication-flow.md) - section 8, the
  gateway as the entry point, and section 8.1, hybrid development access
- [`../deployment-architecture.md`](../deployment-architecture.md) - section 3.1,
  the environment rules

