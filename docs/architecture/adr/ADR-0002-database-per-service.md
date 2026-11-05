# ADR-0002: Database per Service

**Status:** Accepted (reconstructed)
**Date:** Undated — reconstructed from source at commit `ec4484c`

---

## Context

The platform has five domain services with clearly separated responsibilities:
identity, administration and reference data, the commercial catalog, tax
configuration, and field work orders. Two options were available for
persistence:

1. **One shared database** with all tables in one schema.
2. **One database per service**, each owning its tables exclusively.

A shared database is simpler to operate and allows cross-service joins, but it
couples the services: any schema change in one area risks breaking another,
and "which service owns this table" becomes ambiguous.

## Decision

**Each domain service owns exactly one PostgreSQL database. No service reads or
writes another service's tables.**

| Service | Database |
|---|---|
| `auth-service` | `akura_auth` |
| `app-manager-service` | `akura_app_manager` |
| `marketing-service` | `akura_marketing` |
| `finance-service` | `akura_finance` |
| `fieldservice-service` | `akura_fieldservice` |

The API Gateway owns no database.

Data that another service needs is reached through an API call (see
[ADR-0001](./ADR-0001-gateway-as-single-entrypoint.md)) or replicated as a
read model via an event (see
[ADR-0003](./ADR-0003-http-outbox-over-message-broker.md)).

### Referential integrity across the boundary

Since foreign keys cannot span databases, cross-service references are bare
`uuid` columns. The most significant is `officeBranchId`, which points at
`app-manager-service.office_branches` from Marketing, Finance, and Field
Service. The integrity guarantee is moved entirely into the application layer:
every query is scoped to the authenticated user's branch, and the branch is
derived from the verified token and the live Auth profile — never from a
request parameter.

Where a cross-service record is referenced, the consuming service stores a
**JSON snapshot** of it, projected through an explicit allowlist so that no
price or unvetted field can leak into a stored column.

## Consequences

**Positive**

- Clear ownership: exactly one service can write any table.
- A schema change in one service cannot break another.
- Each database can be scaled, backed up, or restored independently.
- The service boundary is enforced by the database, not only by convention.

**Negative**

- **No cross-service joins.** Anything spanning services requires an API call.
- **No cross-database referential integrity.** An orphaned `officeBranchId` is
  undetectable at the database level; only the application layer prevents it.
- **Branch deletion is unsafe.** Deleting a branch in App Manager leaves
  dangling references in three other databases. No cascade, no orphan
  detection, and no reconciliation job exists.
- **Reporting across services requires federation.** Combining data from
  Marketing and Finance for analysis means multiple queries plus application-
  level joining.

**Neutral**

- The replicated read model (`tax_cache`) is a deliberate projection. It
  carries a version marker so a stale or replayed event is ignored, and it is
  rebuilt from its source of truth rather than being edited. The user directory
  is not replicated at all: it is read live from Auth.

## Known issue

**The `taxes` table is declared in two schemas.** `app-manager-service` maps a
`Tax` model to `taxes` (`prisma/schema.prisma:89-104`), but a recursive search
of its `src/` finds no reference to it. Finance owns the live table
(`finance-service/prisma/schema.prisma:24-39`).

**VERIFIED** — the two model declarations are **identical**: the same fields,
the same `@@unique([officeBranchId, effectiveFrom])`, and the same
`@@map("taxes")`. A `prisma db push` against both databases therefore creates
the same table shape in both and will not fail on a column mismatch. The risk
is quieter: the App Manager database carries a `taxes` table that nothing
reads or writes, and it will drift out of step with Finance's copy over time.

Similarly, `finance-service` declares `TaxCache` and `TaxSyncState` models that
are never used, while `marketing-service` declares an unused `TaxSyncState`.

**Recommendation:** remove the orphan models. Finance is the sole owner of
taxes; Marketing's `tax_cache`/`tax_cache_revisions` are the live pair. This
is a schema change and was deliberately **not** applied as part of the
documentation work.

## Evidence

| Claim | Location |
|---|---|
| One datasource per service | `<service>/prisma/schema.prisma` |
| `officeBranchId` has no relation | `marketing-service`, `finance-service`, `fieldservice-service` schemas |
| Branch comes from the token, never a parameter | `auth-service/src/modules/user-management/user-management.routes.ts:12-13` |
| Snapshot allowlist projection | `fieldservice-service/src/integrations/gateway.ts:40-42` |
| Orphaned `Tax` model | `app-manager-service/prisma/schema.prisma:89-104` |

## Related

- [`../database-and-data-ownership.md`](../database-and-data-ownership.md) — the full ownership map
- [ADR-0003](./ADR-0003-http-outbox-over-message-broker.md) — how read models are populated
