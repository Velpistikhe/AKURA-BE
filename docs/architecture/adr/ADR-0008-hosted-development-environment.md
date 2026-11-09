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

**Keep the development guard, and let it accept a remote target that the
operator names explicitly.**

The guard becomes `assertAllowedTarget`, and a new environment variable
`DEV_ALLOWED_REMOTE_HOSTS` lists, by host name, the remote targets a
development run may reach:

| Rule | Effect |
|---|---|
| The local machine is always allowed | `localhost`, `127.0.0.1`, `::1`, `0.0.0.0` need no declaration |
| A remote host is allowed only when listed | `DEV_ALLOWED_REMOTE_HOSTS` is a comma-separated list of host names |
| The list is literal, never a wildcard | A `*` entry does not match anything; naming one host does not open another |
| The guard applies only in development | Outside development the variable is ignored and a warning is logged |
| Every guarded target is covered | `DATABASE_URL`, `API_GATEWAY_URL`, `AWS_ENDPOINT_URL_S3`, `TAX_DELIVERY_TARGETS[]`, and the gateway's `*_SERVICE_URL` / `AUTH_JWKS_URL` |

**The allowlist is per host, not per environment.** A Neon development
branch has its own host, and a deployed service has its own host, so the
allowlist that unlocks the development environment does not unlock production.
A production branch, a production deployment, or a typo in a hostname is
still refused at startup.

**The gateway stays the only entry point, in every environment.** A service
refuses any request that does not carry its own gateway secret, and there is
no development bypass: no environment flag relaxes the check, and there is no
loopback exception. The gateway injects the per-service secret on every
proxied request, so a request that reaches a service directly is rejected
with 403. The browser therefore always calls the gateway, and the gateway
owns the origin policy.

## Consequences

**Positive**

- **One running service is enough.** The developer starts the service under
  work and points it at the hosted gateway and the shared Neon branch.
- **The environment is shared.** The deployed gateway, the deployed Auth, and
  the Neon branch behave like the environment the developer is testing against,
  so a defect is reproducible instead of being an artefact of local state.
- **The guard survives.** A run that reaches for an unlisted host still fails
  to start, with a message that names the host it refused.
- **One access model everywhere.** The same rule - the gateway is the only
  entry point - holds in development and in production, so a developer never
  exercises an access path that production does not have.
- **The rule is auditable.** The allowlist is a configuration value in the same
  place as every other environment value, so what a run may reach is visible
  in review.

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
- **A local service is not directly testable from a browser.** The gateway is
  the only client-facing path, so a browser cannot call a local service
  directly. Testing a local service means exercising it through the gateway
  that can reach it.
- **The trust boundary widens.** A developer machine now holds a credential
  that the deployed environment accepts. The secret is development-only, and
  the deployed environment is the development environment, but the credential
  is no longer confined to one machine.

## Evidence

| Claim | Location |
|---|---|
| The development guard | `*/src/config/env.ts` |
| The remote host allowlist | `*/src/config/env.ts` (`parseAllowedRemoteHosts`, `assertAllowedTarget`) |
| The unconditional gateway-secret check | `*/src/middlewares/gateway.middleware.ts` |
| Outbound URL construction | `*/src/utils/serviceUrl.ts` |
| The token returned to the microfrontend | `auth-service/src/modules/auth/auth.controller.ts` |
| The direct request is refused | `marketing-service/tests/01-functional-baseline.test.ts` |
| The test harness stays local | `marketing-service/tests/support/processes.ts`, `.../harness.ts` |

## Related

- [ADR-0001](./ADR-0001-gateway-as-single-entrypoint.md) - the gateway boundary
  this development topology reuses
- [ADR-0004](./ADR-0004-rs256-jwt-with-remote-jwks.md) - why the token must be
  carried as a bearer token in hybrid access
- [`../authentication-flow.md`](../authentication-flow.md) - section 8, the
  gateway as the only entry point, and section 8.1, hybrid development access
- [`../deployment-architecture.md`](../deployment-architecture.md) - section 3.1,
  the environment rules

