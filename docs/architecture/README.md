# Akura — Architecture Documentation

Persistent architecture knowledge for the Akura backend. This directory is the
**starting map** for any future task that touches the platform, and the place
where architectural changes are recorded.

> **Source code remains the source of truth.** These documents are a derived
> map, not the authority. If this documentation and the code disagree, the code
> wins — and the documentation is a bug that should be fixed.

---

## 1. Platform at a glance

Six independently deployable Node.js/TypeScript microservices behind a single
API Gateway, each owning its own PostgreSQL database.

```
                       Client
                         │
                    ┌────▼─────┐
                    │ Gateway  │  api-gateway :5000
                    └────┬─────┘
        ┌──────────┬──────┼──────┬──────────┐
     ┌──▼──┐   ┌───▼───┐ ┌▼────┐ ┌▼──────┐ ┌▼──────────┐
     │Auth │   │ App   │ │Mktg │ │Finance│ │  Field    │
     │:5001│   │ Mgr   │ │:5003│ │ :5004 │ │  :5005    │
     │     │   │:5002  │ │     │ │       │ │           │
     └─────┘   └───────┘ └─────┘ └───────┘ └───────────┘
       5 separate PostgreSQL databases, one per domain service
```

**Two rules explain almost everything else in this repository:**

1. **Every inter-service call passes through the API Gateway.** No service
   stores another service's direct URL. Outbound calls are constructed by each
   service's `src/utils/serviceUrl.ts`, which requires `API_GATEWAY_URL`, rejects
   `..` and `://`, and pins a per-service path allowlist.
2. **There is no message broker.** Asynchronous delivery is an HTTP POST to the
   Gateway, backed by a transactional outbox in the producer's own database.
   The user directory is not replicated at all: Auth is the source of truth and
   no service reads it over the network.

---

## 2. Document map

Read in this order the first time. After that, jump to the document that
matches the task.

| Document | Answers | Read it when |
|---|---|---|
| [`system-overview.md`](./system-overview.md) | What is this platform, what pattern does it use, what is each service responsible for? | First read; any high-level question. |
| [`service-catalog.md`](./service-catalog.md) | What does service X own? Ports, stack, modules, database, endpoints. | You need the specifics of one service. |
| [`service-dependencies.md`](./service-dependencies.md) | Who depends on whom, in which direction, and how tightly? | You are changing a call path or adding a dependency. |
| [`api-gateway-routing.md`](./api-gateway-routing.md) | Which prefix routes where, what headers are added or stripped, what is the documented API surface? | You add or change an endpoint. |
| [`authentication-flow.md`](./authentication-flow.md) | How are tokens issued, verified, and propagated? Where is authorization enforced? | You touch login, tokens, roles, or permissions. |
| [`database-and-data-ownership.md`](./database-and-data-ownership.md) | Which service owns which table? Where do read models live? | You add a table, a field, or a cross-service query. |
| [`integration-and-event-flow.md`](./integration-and-event-flow.md) | How do services talk to each other synchronously and asynchronously? How are retries and idempotency handled? | You add or modify an integration. |
| [`deployment-architecture.md`](./deployment-architecture.md) | How is it deployed? What is verified vs. unknown about production? | You touch deployment, configuration, or environment variables. |
| [`diagrams/`](./diagrams/README.md) | Visual maps of all of the above. | You want orientation before reading prose. |
| [`adr/`](./adr/README.md) | Why is the architecture shaped this way? What decisions were made, and what is still open? | You want rationale, or you are considering a structural change. |

### Cross-cutting reference tables

These live inside the documents above rather than separately, so that each fact
has exactly one home:

- Service inventory and ports → [`service-catalog.md`](./service-catalog.md)
- Full gateway routing table → [`api-gateway-routing.md`](./api-gateway-routing.md)
- Dependency matrix → [`service-dependencies.md`](./service-dependencies.md)
- Table ownership map → [`database-and-data-ownership.md`](./database-and-data-ownership.md)
- Synchronous + asynchronous integration inventory → [`integration-and-event-flow.md`](./integration-and-event-flow.md)
- Known conflicts and risks → [§5 below](#5-known-conflicts-and-risks) and [`adr/ADR-0006-audit-trail-per-service.md`](./adr/ADR-0006-audit-trail-per-service.md)

---

## 3. Confidence labels

Every factual claim in these documents carries one of three labels. Apply the
same convention to anything new you write here.

| Label | Meaning |
|---|---|
| **VERIFIED** | Confirmed directly from source code, configuration, package manifest, or lockfile. The claim cites a `path:line` reference. |
| **INFERRED** | A conclusion drawn from verified evidence, but not literally stated anywhere. The reasoning is given. |
| **UNKNOWN** | Not established by the evidence reviewed. Requires confirmation outside the repository. Use `UNKNOWN` or `NEEDS VERIFICATION` — never guess. |

**Rules that keep this documentation trustworthy:**

- A folder name is never treated as evidence of a service's purpose. Service
  identity was confirmed via `package.json`, `src/server.ts`, and route mounting.
- README files and folder names were explicitly *not* relied upon.
- When two sources conflict, **both are recorded** in
  [§5](#5-known-conflicts-and-risks) rather than silently picking one.
- Secrets, tokens, passwords, and private keys are never reproduced. `.env`
  files are referenced by **variable name only**. The local private key file is
  mentioned only as a gitignored artifact.

---

## 4. How to use this as project knowledge

### Before any task

1. Read this file (the index) to orient.
2. Identify the service(s) the task touches.
3. Read that service's section in [`service-catalog.md`](./service-catalog.md).
4. Read the relevant cross-cutting document — routing, auth, data ownership, or
   integration — depending on the task.
5. **Then** do targeted source inspection on the specific files implicated by
   the documents. Use the file paths cited here as your starting points.

### Scope discipline

Do **not** run a full repository scan by default. The documents exist so that
targeted inspection is sufficient. A full scan is warranted only when the task
genuinely spans services, when the documentation is found to be stale, or when
verifying a change that touches several services at once.

### After a task that changes the architecture

Update, in this order:

1. The relevant `.mmd` diagram in [`diagrams/`](./diagrams/README.md).
2. The corresponding markdown document.
3. This index, if a document's scope or a service's responsibility changed.
4. A new ADR in [`adr/`](./adr/README.md) if a decision was made — not
   merely implemented.

A code change that alters routing, data ownership, authentication, or
integration boundaries is an **architecture change** and must be reflected here
before the task is considered complete.

---

## 5. Known conflicts and risks

Full detail in the linked documents. Summary:

| # | Issue | Severity | Detail |
|---|---|---|---|
| 1 | **Duplicate `taxes` table ownership.** `app-manager-service` declares a `Tax` model mapped to `taxes` with **zero source references**. Finance owns the live table. The two declarations are identical, so a push will not fail — the App Manager copy will simply drift. | Medium | [`database-and-data-ownership.md`](./database-and-data-ownership.md) |
| 2 | **Orphaned `tax_cache` / `tax_sync_state` in Finance.** Declared in the Prisma schema, never used in `src/`. Finance's real cache is in Marketing. | Medium | [`database-and-data-ownership.md`](./database-and-data-ownership.md) |
| 3 | **The "platform-wide" audit trail is fragmented.** `GET /api/v1/app-manager/audit-trail` returns only App Manager's own rows. Marketing writes a *separate* `audit_logs` + `catalog_audit_logs` in its own database. Nothing aggregates them. | **High** | [`adr/ADR-0006-audit-trail-per-service.md`](./adr/ADR-0006-audit-trail-per-service.md) |
| 4 | **Divergent audit schemas.** Marketing's `AuditLog` has `@@unique([entityType, entityId, version])`; App Manager's does not (deliberately, per its own comment). | Low | [`database-and-data-ownership.md`](./database-and-data-ownership.md) |
| 5 | **Conditional routing.** `/api/v1/finance` and `/api/v1/fieldservice` are registered only when URL + secret are both configured. A service can be silently absent from the gateway. | Medium | [`api-gateway-routing.md`](./api-gateway-routing.md) |
| 6 | **Production topology unverifiable.** `vercel.json` exists for 4 of 6 services; Finance and Field Service have none. No Dockerfile, CI workflow, or IaC exists in-repo. | Medium | [`deployment-architecture.md`](./deployment-architecture.md) |
| 7 | **No cross-database referential integrity.** `officeBranchId` is a bare `uuid` in three services with no FK and no cross-service validation for some paths. | Medium | [`database-and-data-ownership.md`](./database-and-data-ownership.md) |
| 8 | **Prior documentation was removed and contained stale claims.** Commit `ec4484c` deleted `.project-map/` and `.ai-context/`. Those files asserted a shared `akura_auth` database and an absent test suite; both are now false. Their claims were re-verified from scratch rather than reused. | Informational | [`adr/ADR-0007-replace-removed-project-map-documentation.md`](./adr/ADR-0007-replace-removed-project-map-documentation.md) |

---

## 6. Repository facts worth knowing before you start

- **No root `package.json`, no workspaces, no monorepo tooling.** Each service
  installs, builds, tests, and releases independently.
- **Each service is its own npm package** with its own `package-lock.json`.
- **No Dockerfile, docker-compose, GitHub Actions workflow, or Terraform.**
  Deployment is configured entirely outside this repository.
- **ESM throughout.** Every `tsconfig.json` uses `module: NodeNext`. Imports
  carry explicit `.js` extensions.
- **Environment variables are schema-validated at startup** with `zod` in every
  service. A misconfigured service exits rather than running degraded.
- **Only `api-gateway` declares an `engines` field**; the five domain services
  do not, so their production Node version is not pinned by this repository.
- **Testing lives in one place.** `marketing-service/tests/` holds an 11-file
  reliability suite (functional, concurrency, stress, event-sync, audit-trail)
  that boots all six services against dedicated `_test` databases.

---

## 7. Maintenance

| Aspect | Status |
|---|---|
| Last full verification | This discovery pass, against commit `ec4484c` (branch `main`). |
| Verification method | Source reading, package manifests, Prisma schemas, `.env.example` files, Vercel configs, and read-only runtime probes of Express routing behavior. |
| Not verified | Production deployment topology, CI/CD pipeline, external S3 provider, production secret rotation, network/TLS/WAF topology, JWT key rotation policy. |
| Review trigger | Any change to gateway routing, service boundaries, data ownership, auth, or integration patterns. |

