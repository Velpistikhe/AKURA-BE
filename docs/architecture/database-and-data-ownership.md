# Database and Data Ownership

> Which service owns which table, where read models live, and how referential
> integrity is maintained (or not) across database boundaries.
> Confidence labels are defined in [`README.md`](./README.md#3-confidence-labels).
> Source of truth: each service's `prisma/schema.prisma`.

---

## 1. Database topology

**VERIFIED** — five PostgreSQL databases, one per domain service. The gateway
has none.

| Service | Database | Schema location |
|---|---|---|
| `api-gateway` | **none** | — |
| `auth-service` | `akura_auth` | `auth-service/prisma/schema.prisma` |
| `app-manager-service` | `akura_app_manager` | `app-manager-service/prisma/schema.prisma` |
| `marketing-service` | `akura_marketing` | `marketing-service/prisma/schema.prisma` |
| `finance-service` | `akura_finance` | `finance-service/prisma/schema.prisma` |
| `fieldservice-service` | `akura_fieldservice` | `fieldservice-service/prisma/schema.prisma` |

Every datasource is `provider = "postgresql"` with `url = env("DATABASE_URL")`.
**VERIFIED** — the five `DATABASE_URL` values resolve to five distinct
database names; no two services share a database.

**VERIFIED** — this contradicts the removed `.project-map/architecture.md`,
which stated that Auth and App Manager shared `akura_auth`. That claim was
re-verified and found false; see
[ADR-0007](./adr/ADR-0007-replace-removed-project-map-documentation.md).

---

## 2. Ownership by service

### 2.1 auth-service — `akura_auth`

**Authoritative for: users, credentials, and user history.**

| Model | Purpose |
|---|---|
| `User` | The user record: identity, role, section, office branch, active flag |
| `UserPassword` | Password hash, separate from the user row |
| `UserHistory` | Audit of user field changes |
| `RefreshToken` | Issued refresh tokens; server-side revocable |
| `UserSyncEvent` | Outbox of user-change events |
| `UserSyncDelivery` | Per-target delivery attempts and retry schedule |
| `SecurityAuditLog` | Login, register, logout, and failed-login records |
| `UserRole` (enum) | `USER` \| `ADMIN` \| `APP_MANAGER` → `user_role` |
| `UserSection` (enum) | `ACCOUNTING` \| `FINANCE` \| `HRD_MANAGEMENT` \| `MARKETING` \| `FIELD_SERVICE` → `user_section` |

### 2.2 app-manager-service — `akura_app_manager`

**Authoritative for: navigation structure and office-branch reference data.**

| Model | Purpose |
|---|---|
| `Menu` | Top-level navigation entries |
| `MenuItem` | Items within a menu |
| `MenuAccess` | Which role/section may see which menu item |
| `OfficeBranch` | The platform's master list of branches (with `isHead`) |
| `AuditLog` | Audit entries **for App Manager's own entities only** |
| `Tax` | ⚠ **Orphan** — see §5.1 |

### 2.3 marketing-service — `akura_marketing`

**Authoritative for: the commercial catalog, quotations, and contracts.**

| Area | Models |
|---|---|
| Customers | `Company`, `CompanyStaff`, and their history snapshots |
| Catalog | `Service`, `ServiceScope`, `Item`, `ItemSize`, `ItemPrice` |
| Contracts | `CompanyContract`, `CompanyContractPrice`, contract-price history, `ContractCatalogSnapshot` |
| Quotations | `Quotation`, `QuotationItem`, `QuotationHistory`, `QuotationPdf`, `QuotationSnapshot` |
| Read models | `MarketingAdminUser` (from Auth), `TaxCache` (from Finance) |
| Revisions | `MarketingUserSyncRevision`, `TaxCacheRevision` |
| Audit | `AuditLog`, `CatalogAuditLog` |
| Orphan | `TaxSyncState` — see §5.2 |

### 2.4 finance-service — `akura_finance`

**Authoritative for: tax configuration.**

| Model | Purpose |
|---|---|
| `Tax` | The tax rate per office branch, keyed uniquely by `[officeBranchId, effectiveFrom]` |
| `TaxRevision` | Immutable snapshot of a tax value at a given version |
| `TaxEvent` | Outbox of tax-change events |
| `TaxDelivery` | Per-target delivery attempts and retry schedule |
| Orphan | `TaxCache`, `TaxSyncState` — see §5.2 |

### 2.5 fieldservice-service — `akura_fieldservice`

**Authoritative for: work orders.**

| Model | Purpose |
|---|---|
| `WorkOrder` | The work order: branch, number, status, quotation/contract snapshots |
| `WorkOrderItem` | Item lines with an item snapshot and quantities |
| `WorkOrderInspector` | Assigned inspectors with an ordered position |
| `WorkOrderSequence` | Sequencing data |
| `WorkOrderHistory` | Status-change history |
| `FieldServiceUser` | Read model replicated from Auth |
| `FieldServiceUserSyncRevision` | Version marker for the read model |
| `AuditLog` | Work-order audit entries |

---

## 3. Referential integrity across database boundaries

**VERIFIED** — there are **no cross-database foreign keys**, and none are
possible. Cross-service references are bare `uuid` columns.

### 3.1 `officeBranchId` — the platform's central logical reference

**VERIFIED** — the `office_branches` table lives **only** in
`akura_app_manager`. In Marketing, Finance, and Field Service,
`officeBranchId` is a plain `String @db.Uuid` column with an index and **no
`@relation`**:

| Service | Declaration |
|---|---|
| marketing | `officeBranchId String @map("office_branch_id") @db.Uuid` — no relation |
| finance | same pattern |
| fieldservice | `officeBranchId String @map("office_branch_id") @db.Uuid` (`schema.prisma:18`) |

**Consequence:** the database cannot enforce that a Marketing record points at
a real branch. The guarantee is provided by the application layer, by scoping
every query to the authenticated user's branch, which is derived from the
verified token and the live Auth profile — never from a request parameter.

**VERIFIED** — this is stated explicitly in the code:

> *"Branch ownership is checked before updating a quotation."*
> — `api-gateway/src/docs/quotation.ts:196`

And in the Auth marketing-contacts lookup:

> *"Read-only; branch always comes from the calling authenticated user, never
> from a request parameter."*
> — `auth-service/src/modules/user-management/user-management.routes.ts:12-13`

**Risk:** if a branch is deleted or renamed in App Manager, records in three
other databases keep pointing at it. No cascading delete, no orphan detection,
and no reconciliation job exist. **UNKNOWN** — whether branch deletion is
blocked in App Manager when references exist elsewhere was not established.

### 3.2 Other cross-service id references

| Reference | From | To | Enforcement |
|---|---|---|---|
| `quotationId` | `WorkOrder` | `Quotation` (Marketing) | Application: Field Service re-fetches the live quotation and validates branch + `APPROVED` status (`fieldservice-service/src/integrations/gateway.ts:144-169`) |
| `contractId` | `WorkOrder` | `CompanyContract` (Marketing) | Application: contract snapshot captured at creation |
| `itemSizeId` | `WorkOrderItem` | `ItemSize` (Marketing) | Application: item snapshot captured at creation |
| `userId` | `WorkOrderInspector` | `User` (Auth) | Application: live re-validation before start (`fieldservice-service/src/integrations/gateway.ts:205-226`) |
| `companyId` | `CompanyContract` | `Company` (Marketing) | **Same database** — real FK, `onDelete: Restrict` |

**The pattern is consistent:** cross-database references are validated in
application code at the moment of use, and the referenced data is captured as a
JSON **snapshot** so historical records survive later changes.

### 3.3 Snapshot strategy

**VERIFIED** — where a cross-service record is referenced, the consuming
service stores a JSON snapshot rather than a live pointer:

- `WorkOrder.quotationSnapshot` (`@db.JsonB`)
- `WorkOrder.contractSnapshot` (`@db.JsonB`)
- `WorkOrderItem.item` (`@db.JsonB`)
- `Quotation.companySnapshot`, `CompanyContract.contractSnapshot`
- `ContractCatalogSnapshot` — *"Frozen catalog identity at contract-price
  creation/import. Catalog edits and soft deletion never refresh this
  snapshot."* (`api-gateway/src/docs/catalog.ts`)

**Important:** the Field Service integration uses an **explicit allowlist
projection** when building these snapshots, so no price or stray column can
reach a `jsonb` column:

> *"Price fields are validated here so an incomplete upstream payload still
> fails as 502, but they are deliberately dropped by toQuotationSnapshot and
> never persisted."*
> — `fieldservice-service/src/integrations/gateway.ts:40-42`

This is a deliberate data-minimisation control, not an accident of schema.

---

## 4. Read models (replicated projections)

**VERIFIED** — three tables are replicas of another service's data, each
maintained by an idempotent event receiver.

| Read model | Source of truth | Replicated by | Version marker |
|---|---|---|---|
| `marketing_admin_users` | `auth.users` | Auth outbox → `POST marketing/internal/users/events` | `marketing_user_sync_revisions` |
| `field_service_users` | `auth.users` | Auth outbox → `POST fieldservice/internal/users/events` | `field_service_user_sync_revisions` |
| `tax_cache` | `finance.taxes` | Finance outbox → `POST marketing/internal/taxes/events` | `tax_cache_revisions` |

### 4.1 What the read models deliberately omit

**VERIFIED** — `marketing-service/src/modules/user-sync/marketing-contact.repository.ts:4-10`:

```ts
interface MarketingAdminUserSnapshot {
  firstName: string;
  lastName: string;
  email: string | null;
  telp: string | null;
}
```

Only four fields are replicated. Password hashes, roles, refresh tokens, and
security audit logs never leave `akura_auth`.

**VERIFIED** — the tax cache stores the tax rate rows only; Finance's
`TaxRevision`, `TaxEvent`, and `TaxDelivery` tables are never replicated.

### 4.2 Read-model staleness handling

**VERIFIED** — each receiver compares the incoming version against its stored
revision and **ignores** anything not newer:

`marketing-service/src/modules/taxes/tax-events.routes.ts:33-51`

```ts
const current = await tx.taxCacheRevision.findUnique({ where: { officeBranchId: event.officeBranchId } });
if (current && current.version >= event.version) {
  // acknowledge without changing the cache
}
```

The OpenAPI description confirms the contract:

> *"Atomic branch cache replacement; duplicate and older versions are
> acknowledged without changing cache. Acknowledgment is sent only after
> commit."*
> — `api-gateway/src/docs/tax.ts:56`

This makes the receivers **idempotent** and safe to retry.

### 4.3 A read model is not authoritative

**VERIFIED** — where correctness depends on fresh data, the code re-reads from
the source of truth instead of trusting the replica. Field Service validates
inspectors against **live Auth** before starting a Work Order, explicitly
noting that the stored snapshot "must still exist in Auth as an active
FIELD_SERVICE user of the caller branch with the same canonical display name"
(`fieldservice-service/src/integrations/gateway.ts:205-210`).

---

## 5. Ownership conflicts

### 5.1 Conflict — two owners claim the `taxes` table

**VERIFIED**:

| Service | Schema location | Model | Referenced in `src/`? |
|---|---|---|---|
| `app-manager-service` | `prisma/schema.prisma:89-104` | `model Tax` → `@@map("taxes")` | **No** — zero references anywhere in `src/` |
| `finance-service` | `prisma/schema.prisma` | `model Tax` → `@@map("taxes")` | **Yes** — the live implementation |

**VERIFIED** — a recursive search of `app-manager-service/src` for `tax`
returns **no matches at all**. The App Manager model is not used by any route,
repository, or query.

**Consequences:**
- **The two model declarations are byte-for-byte identical.** A field-by-field
  comparison of the `Tax` model in both schemas (`app-manager-service/prisma/schema.prisma:89-104`
  and `finance-service/prisma/schema.prisma:24-39`) shows the same fields, the
  same `@@unique([officeBranchId, effectiveFrom])`, and the same
  `@@map("taxes")`. This means a `prisma db push` against both databases
  produces **the same table shape in both** — so the push will *not* fail on
  column mismatch. The risk is different, and quieter than a schema error.
- **The App Manager database carries a live `taxes` table that nothing reads
  or writes.** It will silently drift: Finance's code adds a column or
  changes a constraint, and App Manager's copy does not follow, because no
  App Manager migration is ever run against it.
- **A reader of `app-manager-service/prisma/schema.prisma` would reasonably
  conclude that App Manager owns taxes.** It does not. The identical shape
  makes the mistake easy to make — there is no visible signal that the model
  is dead code.

**Recommended remediation (not applied — schema changes are out of scope for
this documentation task):** remove the `Tax` model from
`app-manager-service/prisma/schema.prisma` and drop the `taxes` table from the
App Manager database. Finance is the sole owner.

### 5.2 Conflict — orphaned tax-cache models

**VERIFIED**:

| Service | Model | Table | Referenced in `src/`? |
|---|---|---|---|
| `finance-service` | `TaxCache` (`schema.prisma:8-16`) | `tax_cache` | **No** |
| `finance-service` | `TaxSyncState` (`schema.prisma:18-21`) | `tax_sync_state` | **No** |
| `marketing-service` | `TaxSyncState` (`schema.prisma:550-554`) | `tax_sync_state` | **No** |

The **live** tax cache is `marketing-service`'s `tax_cache`, used by
`marketing-service/src/modules/taxes/tax-sync.ts:6` and
`tax-events.routes.ts:35-36`.

**Consequences:**
- Finance creates two tables it never reads or writes. They are dead weight
  in `akura_finance` and mislead anyone reading the schema.
- Two services both declare a `tax_sync_state` table with different
  definitions, in different databases, both unused.

**Recommended remediation:** remove `TaxCache` and `TaxSyncState` from
`finance-service/prisma/schema.prisma`, and `TaxSyncState` from
`marketing-service/prisma/schema.prisma`. Marketing's `tax_cache` and
`tax_cache_revisions` are the live pair.

### 5.3 Conflict — the audit trail is not platform-wide

**VERIFIED** — `GET /api/v1/app-manager/audit-trail` reads **only**
`app-manager-service`'s own `audit_logs` table
(`app-manager-service/src/modules/audit-trail/audit-trail.repository.ts:42-73`).
It performs no cross-service query and has no way to reach Marketing's rows.

Meanwhile Marketing writes its own `audit_logs` **and** `catalog_audit_logs`
in `akura_marketing`
(`marketing-service/src/utils/audit.ts:81`, `marketing-service/src/utils/catalogAudit.ts:16`).

**The endpoint name implies a platform-wide trail that does not exist.**
Marketing's audit entries are not visible through it. See
[ADR-0006](./adr/ADR-0006-audit-trail-per-service.md) for the full analysis
and options.

### 5.4 Divergence — audit table constraints differ

**VERIFIED** — the two `AuditLog` models are not identical:

| | marketing `audit_logs` | app-manager `audit_logs` |
|---|---|---|
| `@@unique([entityType, entityId, version])` | **Yes** | **No** |
| Reason | Retries cannot create a second entry for the same entity state | Entities without a version column record a millisecond timestamp; *"Two writes to the same entity inside one millisecond would collide on a unique constraint and fail the write"* |

**Assessment:** the divergence is deliberate and documented in App Manager's
schema comment, not an oversight. But it means the two trails have different
duplicate-entry semantics, which complicates any future aggregation.

### 5.5 Divergence — audit module taxonomies differ

**VERIFIED** — Marketing constrains the audit vocabulary with TypeScript
unions (`marketing-service/src/utils/audit.ts:35-48`):

```ts
export type AuditModule = 'companies' | 'company-staff' | 'contract-prices'
  | 'contracts' | 'items' | 'quotations' | 'services' | 'taxes' | 'user-sync';
export type AuditEntity = 'COMPANY' | 'COMPANY_STAFF' | 'QUOTATION'
  | 'TAX' | 'USER_SYNC';
```

App Manager uses free-form `String` columns (`VarChar(50)`) with no enum.

---

## 6. Concurrency and transactional guarantees

### 6.1 Optimistic concurrency

**VERIFIED** — mutable entities carry a `version Int @default(0)` column.
Updates compare the submitted version against the stored one and return
**409** when stale. The OpenAPI spec documents the field as:

> *"Concurrency token. Submit the latest resource version; stale versions
> return 409."*
> — `api-gateway/src/docs/catalog.ts:3`

The update pattern is a conditional `updateMany` on `{ id, version }`, so two
concurrent writers cannot both succeed — the loser matches zero rows.

### 6.2 Audit entries commit with the change

**VERIFIED** — the audit write is inside the same transaction as the change it
describes:

> *"The write must run inside the same transaction as the change it describes,
> so the audit trail and the data can never disagree: either both are
> committed, or neither is."*
> — `marketing-service/src/utils/audit.ts:60-66`

This holds across services: App Manager's `recordAudit` takes a
`Prisma.TransactionClient` and is called with `tx` inside every repository
mutation (e.g. `menu.repository.ts:79`, `menu-item.repository.ts:85`,
`menu-access.repository.ts:96`).

### 6.3 Advisory locks for serialised invariants

**VERIFIED** — where a business rule spans multiple rows, the code takes a
PostgreSQL advisory lock inside the transaction.

**Finance tax creation** (`finance-service`):

```sql
SELECT pg_advisory_xact_lock(hashtext('tax-branch:' || officeBranchId))
```

This serialises concurrent tax writes for the same branch, allowing the
service to close the prior period and open the new one without a race. The
unique constraint `Tax @@unique([officeBranchId, effectiveFrom])` is the
second line of defence.

**Outbox delivery** — `pg_try_advisory_xact_lock(hashtext(<id>))` ensures
**exactly one** instance delivers a given job when several replicas run
concurrently.

**App Manager head branch** — a transaction advisory lock plus a partial
unique index in the database (`prisma/sql/0001_single_head_office_branch.sql`).

The migration file explains the layering:

> *"The application also guards the rule with a transaction advisory lock,
> but that lock only protects writers that go through the service. This index
> protects the data itself, whatever writes it."*

### 6.4 Isolation levels

**VERIFIED** — read-heavy audit and history queries use
`prisma.$transaction([...], { isolationLevel: 'RepeatableRead' })` so that the
page of rows and the total count are computed from a consistent snapshot
(e.g. `marketing-service/src/modules/contracts/contract-excel.repository.ts:44-47`).

### 6.5 Soft deletes

**VERIFIED** — records are revoked rather than deleted:

| Entity | Flag |
|---|---|
| Marketing catalog entities | `revoked Boolean` |
| App Manager menus and menu items | `isDeleted Boolean` + `isActive Boolean` |
| Work Orders | `revoked Boolean` |
| Users | `isActive Boolean` |

Soft-deleted App Manager rows also get `isActive = false`
(`menu.repository.ts:134`, `menu-item.repository.ts:133`). Each soft delete is
recorded in the audit trail.

---

## 7. Schema management

**VERIFIED** — each domain service exposes the same script set:

| Script | Action |
|---|---|
| `npm run db:generate` | `prisma generate` — regenerate the client |
| `npm run db:push` | `prisma db push` — apply the schema directly |
| `npm run db:migrate` | *(App Manager only)* — apply the hand-written SQL migration via `scripts/apply-migrations.mjs` |
| `npm run db:studio` | `prisma studio` |
| `npm run db:seed` | Seed data |

**VERIFIED** — there are **no Prisma migration files** in any service
(`prisma/migrations/` does not exist). The schema is applied with
`prisma db push`, which is a development-friendly workflow: it diffs the
schema against the database and applies the change without generating a
migration history.

**Consequence:** there is no recorded migration lineage, so a production
rollout has no ordered, replayable set of migrations to apply — only a
schema-state diff. **UNKNOWN** — what the production rollout procedure
actually is was not established from the repository.

**App Manager is the exception**: it maintains one hand-written SQL migration
in `prisma/sql/`, applied by `scripts/apply-migrations.mjs`. The script is
idempotent (`CREATE UNIQUE INDEX IF NOT EXISTS`) and fails loudly if the
table does not exist yet.

**Recommendation:** adopt `prisma migrate` (or at minimum a versioned SQL
migration directory) for production, and resolve the `taxes` ownership
conflict (§5.1) before the next `db push`.

---

## 8. Summary — ownership rules to respect

| Rule | Reason |
|---|---|
| A table is owned by exactly one service | Database-per-service isolation |
| Other services read it through the API, never directly | Cross-database queries would break the boundary |
| Cross-service references use a snapshot | Preserves history; avoids live joins |
| Replicated data is a projection, never a source of truth | The producer owns the truth; the replica is disposable |
| Branch scoping comes from the token, never a parameter | Prevents cross-branch data access |
| Every mutation writes its audit entry in the same transaction | The trail and the data cannot disagree |
| Deletion is a revoke, not a delete | History and audit references must survive |

**Adding a new table:** decide the owning service first. If another service
needs the data, expose an endpoint (or publish an event) rather than adding a
column to a second schema.




