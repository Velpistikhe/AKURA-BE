# Database Schema

> Derived from the 2026-11-04 exploration pass. All five domain datasources are `postgresql`.
> No schema or database command was run to produce this file.

## Database ownership

| Service | Database | Prisma datasource |
|---|---|---|
| auth-service | `akura_auth` | `auth-service/prisma/schema.prisma` |
| app-manager-service | `akura_auth` **(shared)** | `app-manager-service/prisma/schema.prisma` |
| fieldservice-service | `akura_fieldservice` | `fieldservice-service/prisma/schema.prisma` |
| finance-service | `akura_finance` | `finance-service/prisma/schema.prisma` |
| marketing-service | `akura_marketing` | `marketing-service/prisma/schema.prisma` |
| api-gateway | *none* | no Prisma client |

Client lifecycle: `*/src/config/db.ts` (`connectDb` / `disconnectDb`), one client per service.
Schema commands per service: `db:generate` (`prisma generate`), `db:push` (`prisma db push`). No migration framework is in use.

## Schemas used

All datasources declare `provider = "postgresql"` and target `schema=public` (from `DATABASE_URL` in each `*.env.example`). No service uses a non-default Prisma schema namespace.

## Shared database: `akura_auth`

`auth-service` and `app-manager-service` publish into the **same** database. They do not collide on tables:

| Owner | Tables |
|---|---|
| auth-service | `users`, `user_histories`, `user_passwords`, `refresh_tokens`, `user_sync_events`, `user_sync_deliveries` |
| app-manager-service | `menus`, `menu_items`, `menu_accesses`, `office_branches`, `taxes` (unused, see below) |

The two schemas **do** declare the same PostgreSQL enums, which is the real coupling.

## Shared enums

Identical definitions exist in both `auth-service/prisma/schema.prisma` and `app-manager-service/prisma/schema.prisma`:

```prisma
enum UserSection {
  ACCOUNTING  FINANCE  HRD_MANAGEMENT  MARKETING  FIELD_SERVICE
  @@map("user_section")
}

enum UserRole {
  USER  ADMIN  APP_MANAGER
  @@map("user_role")
}
```

Why they are duplicated: `MenuAccess` (`app-manager`) references `role` and `section`, and app-manager needs those enums without depending on auth-service's tables.

**Risk:** the two schemas migrate `akura_auth` independently. Editing an enum in one schema without the other leaves the definitions out of step. No divergence exists today.

## Data integrity risks

### 1. Shared-enum drift (open question)
Both schemas own `user_section` and `user_role` in one database. Coordination is manual. See `decisions.md`.

### 2. Unused `Tax` model in app-manager (open question)
`app-manager-service/prisma/schema.prisma:89` declares `model Tax` mapped to `taxes`, with **zero references anywhere in `app-manager-service/src`**. `db:push` therefore provisions a dead `taxes` table in `akura_auth`.

Finance owns a **real** `taxes` table in `akura_finance` (plus `tax_revisions`, `tax_events`, `tax_deliveries`, `tax_cache`, `tax_sync_state`). Because the databases differ, this is a schema-level duplicate rather than a runtime collision — but a table of the same name exists in two places, which is a footgun for any future consolidation. See `decisions.md`.

### 3. No foreign key on `User.officeBranchId` (open question)
In `auth-service/prisma/schema.prisma`, the `User` model declares:

```prisma
officeBranchId  String?  @map("office_branch_id")  @db.Uuid
@@index([officeBranchId])
```

with **zero `@relation` tags in the model** — hence no FK constraint. It cannot reference `office_branches`, because that table is declared only by app-manager's schema (and in a shared DB that would still be an unusual cross-schema coupling).

Consequences:
- Branch integrity is enforced **entirely in application code**.
- A deleted or misspelled branch ID is not rejected by the database.
- Every event payload carries `officeBranchId` and is validated against the record's own branch in `superRefine`, but that validates *consistency of the payload*, not *existence of the branch*.

Enforcement points (application level only): `marketing-service/src/utils/officeBranch.ts` (`getOfficeBranchId`), the `authorize`/`actor` middleware branch re-check, and branch assertions inside every event schema.

## Prisma models worth knowing

### auth-service
| Model | Table | Notes |
|---|---|---|
| `User` | `users` | `version Int` for optimistic concurrency; `normalizeUsername` unique |
| `UserHistory` | `user_histories` | change audit |
| `UserPassword` | `user_passwords` | 1:1 with `User`, `onDelete: Cascade` |
| `RefreshToken` | `refresh_tokens` | FK to `User`, `onDelete: Cascade` |
| `UserSyncEvent` | `user_sync_events` | immutable snapshot payload |
| `UserSyncDelivery` | `user_sync_deliveries` | job row: `attempts`, `nextRetryAt`, `lastError`, `deliveredAt`; FK `onDelete: Restrict` |

### app-manager-service
| Model | Table | Notes |
|---|---|---|
| `Menu` / `MenuItem` / `MenuAccess` | `menus`, `menu_items`, `menu_accesses` | access keyed by `role` + `section`; `@@unique([menuItemId, role, section])` |
| `OfficeBranch` | `office_branches` | only declaration of this table anywhere |
| `Tax` | `taxes` | **unused in source** — see risk 2 |

### fieldservice-service
| Model | Table | Notes |
|---|---|---|
| `WorkOrder` | `work_order` | carries `quotationSnapshot JsonB`, `contractSnapshot JsonB`, `revoked`, `version`; FK-less snapshot columns |
| `WorkOrderItem` / `WorkOrderInspector` / `WorkOrderHistory` | children | `onDelete` varies |
| `WorkOrderSequence` | `work_order_sequences` | per-branch numbering |
| `FieldServiceUser` | `field_service_users` | inbound read model from user sync |

### finance-service
| Model | Table | Notes |
|---|---|---|
| `Tax` | `taxes` | the live tax master |
| `TaxRevision` | `tax_revisions` | `officeBranchId @id` + `version` |
| `TaxEvent` / `TaxDelivery` | `tax_events`, `tax_deliveries` | outbox: `attempts`, `nextRetryAt`, `deliveredAt` |
| `TaxCache` / `TaxSyncState` | `tax_cache`, `tax_sync_state` | producer-side mirror |

### marketing-service (largest surface)
| Model | Table | Notes |
|---|---|---|
| `Company` / `CompanyStaff` | `companies`, `company_staffs` | branch-scoped, `revoked` flag |
| `CompanyContract` / `CompanyContractPrice` | `company_contracts`, `company_contract_prices` | lifecycle `DRAFT→SUBMITTED→APPROVED→REVISED/TERMINATED` |
| `Service` / `ServiceScope` / `Item` / `ItemSize` / `ItemPrice` | catalog | `@@unique([officeBranchId, activeKey])`, `@@unique([officeBranchId, normalizeName])` |
| `Quotation` (+`QuotationItem`, `QuotationHistory`, `QuotationPdf`, `QuotationSnapshot`) | quotations | `@@unique([officeBranchId, numberYear, no, revision])`; self-revision via `previousQuotationId` |
| `QuotationSequence` | sequences | `@@id([officeBranchId, year])` — branch+year PK |
| `TaxCache` / `TaxSyncState` / `TaxCacheRevision` | tax read model | consumer side of finance sync |
| `MarketingAdminUser` / `MarketingUserSyncRevision` | user read model | consumer side of auth sync |
| `CatalogAuditLog` | `catalog_audit_logs` | `@@index([officeBranchId, entityType, entityId, createdAt])` |

### Cross-cutting pattern
`officeBranchId` appears **21×** in marketing, **8×** in fieldservice, **7×** in finance, **2×** in auth, **2×** in app-manager. Almost every table is branch-scoped, and most unique constraints are composite with `officeBranchId` as the leading column.

## Concurrency controls in use

Advisory locks appear in 10 files (delivery workers, repositories, audit writers):

- `auth-service/src/modules/user-management/user-management.repository.ts`
- `auth-service/src/modules/user-sync/user-sync.delivery.ts`
- `fieldservice-service/src/modules/user-sync/user-sync.repository.ts`
- `fieldservice-service/src/modules/work-orders/work-order.repository.ts`
- `finance-service/src/modules/taxes/tax-delivery.ts`
- `finance-service/src/modules/taxes/tax.repository.ts`
- `finance-service/src/modules/taxes/tax.routes.ts`
- `marketing-service/src/modules/taxes/tax-events.routes.ts`
- `marketing-service/src/modules/user-sync/user-sync-events.routes.ts`
- `marketing-service/src/utils/companyAudit.ts`

Two forms are used: `pg_try_advisory_xact_lock` (skip if already held, for delivery) and `pg_advisory_xact_lock` (block, for applying an event exactly once).
