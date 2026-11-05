# Project context index

Project: **Akura** — multi-service Node.js + Express backend. 6 independent npm packages (`api-gateway` + 5 domain services), npm, TypeScript, Prisma/PostgreSQL, Express 4, CommonJS runtime.

> **Not a monolith.** There is no root `package.json` and no shared package. Run every command inside a service directory.

## Read selectively

| Page | Read it when |
|---|---|
| `PROJECT.md` | You need runtime/framework/toolchain facts, the service matrix, or default ports/databases |
| `ARCHITECTURE.md` | You need request flow, middleware order, layering, auth model, or persistence details |
| `MODULE-MAP.md` | You need to locate a feature module or find which service owns a capability |
| `COMMANDS.md` | You are about to install, build, typecheck, or run something — **no test/lint commands exist** |
| `DECISIONS.md` | You need to know why the code looks the way it does, or what is still undecided |

## Operating rule

Do not read every page for every task. Start with this index, then open only the page directly relevant to the task. Source code and Serena symbol/reference results are authoritative over stale memory.

## Fast orientation

- **Which service?** → `PROJECT.md` service matrix; `MODULE-MAP.md` for feature ownership.
- **Which file handles this route?** → `<service>/src/routes/index.ts` → the module's `*.routes.ts`.
- **How is a request authenticated?** → `ARCHITECTURE.md` § Request lifecycle (gateway verifies the JWT; services trust `X-User-*` headers).
- **How do I validate my change?** → `COMMANDS.md` — `npm run typecheck` is the only available check.
- **Is this behavior intentional?** → `DECISIONS.md`, then read the source.

## Coverage note

These pages were produced by a one-time onboarding pass over root metadata, service manifests, `tsconfig`s, entry points, route composition, and representative middleware/modules. They are a navigation aid, not a specification. Coverage of individual business rules, every Prisma model, and every endpoint is intentionally **not** included — read the source for those.

## Known gaps (also listed in `DECISIONS.md` → Open questions)

Node `engines` for the 5 domain services; test strategy; lint/format tooling; migration tooling; S3 provider; production deployment platform; OpenAPI coverage target; frontend location.

