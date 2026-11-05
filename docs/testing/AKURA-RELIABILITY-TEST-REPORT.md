# Akura Reliability Test Report

**Run date:** 2026-11-05 (UTC)  
**Status:** Suite implemented and run against dedicated local PostgreSQL databases.  
**Safety:** No production database or deployed service was used.

## Executive summary

- **64/64 tests passed**, 0 failed, 0 skipped, 0 blocked in the final `npm test` run.
- Coverage: marketing, auth, app-manager, finance, and field-service code; the gateway participates in HTTP runs. `fileservice-service` is not covered.
- Local PostgreSQL 17 test DBs: `akura_test_auth`, `akura_test_app_manager`, `akura_test_marketing`, `akura_test_finance`, `akura_test_fieldservice`.
- **Both High findings are closed:**
  - The single-head office branch invariant is now enforced by a partial unique index (`office_branches_single_head_idx`), applied through an idempotent SQL migration and asserted by a database-bypass test.
  - Development environment targets are now guarded at startup: every service refuses a non-local `DATABASE_URL` / service URL when `NODE_ENV=development`. All `.env` files point at localhost, `.env.production` files were removed, and the `.env.example` templates are rewritten with placeholders.
- **Audit trail extended to every service and every module.** Each service now writes to a common append-only audit table, and the auth service records security events (registration, login, refused login, token refresh, logout) with the request context. A dedicated test file asserts the trail for auth, app-manager, marketing, finance, and field-service.

## Services/endpoints tested

| Service | Coverage |
|---|---|
| `api-gateway` | Local health and authenticated proxy path |
| `auth-service` | `POST /register`, `POST /login`, `POST /refresh-token`, `GET /me`, `PUT /profile` |
| `app-manager-service` | Branch create/update, menu create, menu-item create, menu-access create, `GET /audit-trail`, `GET /audit-trail/entity/:id` |
| `marketing-service` | Company create/read/update, staff delete, quotation create/update/submit/approve/revise, service create, internal user/tax events |
| `finance-service` | Tax creation and revision/outbox state |
| `fieldservice-service` | Internal user-sync and work-order number allocation helper |
| `fileservice-service` | Not covered; no test scope added |

## Test environment and runner

- Windows local environment; Node.js **v22.17.1**, npm **10.9.2**, PostgreSQL **17** at `127.0.0.1:5432`.
- Runner: Node built-in `node:test` with existing `tsx` dev dependency (`node --test --import tsx`). No new package installed.
- Five dedicated local test DBs were created and provisioned from current Prisma schemas. `prisma db push --skip-generate --accept-data-loss` was used only against these new localhost DBs with explicit approval. Existing dev DBs, Neon hosts and production DBs were not modified.
- Services ran as child processes on ports `5100–5105`. Local gateway rate limits were raised only for the test process. Quotation PDF storage used an in-memory localhost-only S3-compatible stub. Finance delivery targets were set to `[]`.
- Synthetic `RELTEST` data only. Cleanup truncates only dedicated test databases. Tests run serially; per-test resets make test DB state repeatable.

## Scenarios and results

| Category | Result | Details |
|---|---:|---|
| Functional baseline | **12 passed** | Company CRUD/read, staff delete, auth, validation, tenancy, rejected duplicate leaves no extra company/history |
| Transaction integrity | **Passed** | Duplicate company create rejected; DB showed only successful company + history persisted |
| Audit trail | **Passed** | Quotation version/history uniqueness and auth profile update history checked in DB |
| Lost update / race | **Passed** | Same-version quotation updates: one 200 + one 409; one version increment. Concurrent item adds similarly serialized. Auth profile `FOR UPDATE` applied both updates sequentially; version incremented twice and both history entries were present |
| Quotation numbering | **Passed** | Four concurrent real HTTP approvals gave distinct, gapless numbers; DB sequence matched. Revision inherited parent number without consuming another |
| Refresh rotation | **Passed** | Concurrent use of one refresh token yielded exactly one successful rotation |
| Menu/branch concurrency | **Passed** | Concurrent duplicate menu creation yielded one row; distinct item writes persisted; concurrent head creation left one head in isolated run |
| Finance tax revisions | **Passed** | Concurrent writes produced unique, gapless event versions; period non-overlap and stale-date rejection verified |
| Event sync | **Passed** | User-event replay idempotent; stale user/tax events did not overwrite newer state; secrets enforced; Field Service read-model verified |
| Environment configuration | **7 passed** | .env.example documents every required variable, local .env targets are local only, no .env.production remains, every service guards against remote targets, sync secrets match across services, gateway secrets are unique |
| Audit trail | **12 passed** | Registration, login and refused login recorded with request context; passwords never reach the trail; office branch, menu and catalogue writes recorded with actor and before/after state; a refused write leaves no entry; the trail is append-only and readable per entity and per module |
| Stress/load | **Passed** | 200 list reads (20 concurrent), 40 company creates (10), 100 mixed reads/writes (12); recorded list run had no 5xx/timeouts |

### Recorded stress metrics

| Scenario | Concurrency | Requests | Success | Failure | Timeout | Req/s | Avg | p50 | p95 | p99 | HTTP |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Marketing company list | 20 | 200 | 200 | 0 | 0 | 91.62 | 214.63 ms | 171.04 ms | 690.99 ms | 936.14 ms | 200: 200 |

Wall-clock: 2.18 s. Source: `docs/testing/stress-report.json`. No other stress metrics are claimed.

## Findings and severity

### High — missing DB-level single-head constraint — **CLOSED**

**Evidence:** `app-manager-service/prisma/schema.prisma` documented a partial unique index for `OfficeBranch.isHead`, but Prisma `db push` does not create partial indexes. Read-only inspection found only `office_branches_pkey` in both local `akura_app_manager` and `akura_test_app_manager`; no migration directory existed. Application create/update-to-head used `pg_advisory_xact_lock('office_branch_head')` and the endpoint concurrency test passed, but writers bypassing that application lock were not protected by PostgreSQL.

**Resolution:** the partial unique index `office_branches_single_head_idx` is now created by `app-manager-service/prisma/sql/0001_single_head_office_branch.sql`, applied through the idempotent `scripts/apply-migrations.mjs` runner (`npm run db:migrate`). The harness applies it after every schema push. A regression test drives four concurrent head creations through raw SQL that bypasses the application lock and asserts that exactly one head row survives; a second test asserts the index exists in the database. Prisma reports a violation of the index as `P2002`, which the repository already maps to HTTP 409.

**Impact if unresolved:** duplicate head branches are possible if a future/application-bypassing writer inserts or promotes a head.

### High — unsafe development environment targets — **CLOSED**

**Evidence:** development `.env` database hosts matched the production Neon hosts, Marketing/Field Service development gateway URLs resolved to the deployed gateway, and Finance targeted the deployed Marketing service. Running a service or a test without overrides could have modified real data.

**Resolution:**
- Every `src/config/env.ts` now runs `assertLocalTarget` when `NODE_ENV=development` and refuses a non-local `DATABASE_URL`, `API_GATEWAY_URL`, service URL or delivery target with an explicit startup error.
- All six `.env` files were regenerated against `127.0.0.1` with per-service databases, and the five `.env.production` files were deleted.
- All six `.env.example` templates were rewritten with placeholders and local-only defaults.
- A test file asserts that every `.env.example` documents the variables its service reads, that every local `.env` target is local, that no `.env.production` remains, that every service carries the guard, that the shared sync secrets match across services, and that every gateway secret is unique.

**Impact if unresolved:** a local run could have written to a deployed database or delivered an event to a deployed service.
### Medium — stress scope

Load was bounded to localhost with concurrency ≤20 and ≤200 requests per scenario. No external host, deployed database, or large-scale overload was tested. No overload threshold was reached.

## Transaction and audit observations

- Marketing company create writes the company + history within a transaction; duplicate create left no extra company/history.
- Quotation writes use row locks/version checks and transaction-backed history/snapshots. Concurrent approval verified assigned numbers and the sequence row in the DB.
- Auth profile writes use `FOR UPDATE`, atomic version increments, and history writes in the same transaction. Both concurrent updates applied serially without loss.
- Finance tax writes serialize by branch and enqueue revision/outbox events transactionally; event versions matched accepted writes.
- No fault injection tested a failure between DB commit and external S3 persistence. Distributed DB/object-store atomicity remains unverified.
- **Every service now writes an append-only audit trail.** The auth service records registration, successful and refused logins, token refresh and logout with the client address and user agent; a refused login records the reason but never the password. App-manager records office branch, menu, menu-item and menu-access writes. Marketing records catalogue writes through both its own catalogue table and the common table, plus the tax and user-sync events received from other services. Finance records tax creation and the closing of the previous period. Field Service records work-order writes through its existing history table and the common table.
- **Audit entries are written in the same transaction as the change they describe**, so the trail and the data cannot disagree: a refused write leaves no entry. The trail is append-only; there is no update or delete path in the application.
- **Two bugs were found and fixed while extending the trail.** A route parameter that was read without a params validator returned HTTP 500 on the per-entity trail endpoint; and the audit version was stored as a 32-bit integer while the entities without their own version column use a millisecond timestamp, which would have overflowed and also collided within a single millisecond. The version column is now BigInt, and for those entities it is indexed rather than unique because the transaction already guarantees one entry per committed write.

## Failed, skipped, blocked, and not run

- **Final full suite:** 64 passed, 0 failed, 0 skipped, 0 blocked.
- Earlier development runs exposed incorrect test assumptions/fixtures; those were corrected. The final run is the reported result.
- Not covered: `fileservice-service`, deployed integrations, multi-host contention, production-like load, live S3, and distributed failure injection.
- Application changes made: the single-head SQL migration, the development environment guard, and the audit trail extension. No dependency was added or upgraded.

## Reproduction commands

Run from `marketing-service/` (not the repository root):

```powershell
npm test              # 64 tests, dedicated local databases only
npm run typecheck     # service sources
npm run typecheck:tests  # test sources (separate TypeScript project)
```

Equivalent runner: `node --test --import tsx --test-concurrency=1 "tests/*.test.ts"`.

The test files live in their own TypeScript project (`marketing-service/tests/tsconfig.json`), because the service `tsconfig.json` only includes `src/**/*`. Without that project the editor treats the test files as an inferred project without the Node type definitions and reports `Cannot find name 'node:test'`. The service `tsconfig.json` is unchanged.

The harness only allows its explicit localhost `akura_test_*` database allowlist. The checked-in `.env` files now point at localhost only, and every service refuses a remote target at startup when `NODE_ENV=development`; still, do not run `db:push` against any non-test URL.

