# Architecture Decisions

Record durable decisions that are useful across tasks. Keep entries short.

## Template
- Date:
- Decision:
- Reason:
- Consequences:
- Related paths:

---

## OPEN QUESTIONS — human decision required

No architectural decision is made by this document. The following five findings are recorded for review; confirm intent and desired direction with the project owner before changing application code, Prisma schemas, API documentation policy, or test tooling.

### 1. Unused `Tax` model in app-manager
- **Status:** OPEN QUESTION — keep, repurpose, or remove?
- **Confirmed finding:** `app-manager-service/prisma/schema.prisma` declares `model Tax` mapped to `taxes`; there are zero references in `app-manager-service/src`. It is separate from Finance's live tax data because app-manager uses `akura_auth`, finance uses `akura_finance`.
- **Decision owner to clarify:** Is this table/model intentionally reserved or should it be removed from the app-manager schema?
- **Related paths:** `app-manager-service/prisma/schema.prisma`, `app-manager-service/src/`, `finance-service/prisma/schema.prisma`.

### 2. Shared `akura_auth` database
- **Status:** OPEN QUESTION — keep the shared database or split app-manager into its own database?
- **Confirmed finding:** auth-service and app-manager-service both use `akura_auth`; both schemas declare identical mapped PostgreSQL enums `user_role` and `user_section`.
- **Decision owner to clarify:** Is the shared database intentional, and if so, what is the expected coordination policy for shared enum changes?
- **Related paths:** `auth-service/prisma/schema.prisma`, `app-manager-service/prisma/schema.prisma`, `auth-service/.env.example`, `app-manager-service/.env.example`.

### 3. Missing `User.officeBranchId` foreign key
- **Status:** OPEN QUESTION — add a referential constraint, retain app-level ownership, or use another integrity mechanism?
- **Confirmed finding:** auth-service `User.officeBranchId` is nullable UUID with an index and no Prisma relation/FK. Branch assignment is currently checked at application boundaries. `office_branches` is declared in the app-manager schema.
- **Decision owner to clarify:** Should branch existence be guaranteed by PostgreSQL, and if yes, how should that ownership cross service schemas be represented?
- **Related paths:** `auth-service/prisma/schema.prisma`, `app-manager-service/prisma/schema.prisma`, `marketing-service/src/utils/officeBranch.ts`, domain `src/middlewares/authorize.middleware.ts` / `actor.middleware.ts`.

### 4. Absence of test infrastructure
- **Status:** OPEN QUESTION — select a test framework and initial coverage strategy?
- **Confirmed finding:** no test/spec files, Jest/Vitest config, test scripts or test runner dependencies are present in the inspected repository. Current checks are `npm run typecheck` and `npm run build` per service.
- **Decision owner to clarify:** Which test runner and test scope should be introduced, if any? This entry does not choose one.
- **Related paths:** six service `package.json` manifests; `CLAUDE.md` validation rules.

### 5. Swagger coverage gap
- **Status:** OPEN QUESTION — what documentation coverage target and ownership process should apply?
- **Confirmed finding:** prior reports state 123 and 129 route definitions; these conflict. OpenAPI has 43 paths and 63 operations. Swagger coverage is incomplete in Marketing, Finance and Field Service, but the exact route-vs-path gap is not established until counts are reconciled.
- **Decision owner to clarify:** Should all client-facing routes be documented, and should route changes require Swagger updates in the same change (the repository engineering instruction already requests updates)?
- **Related paths:** `api-gateway/src/docs/openapi.ts`, `api-gateway/src/config/swagger.config.ts`, each service's route modules.

---

No project-specific final decisions recorded yet.
