# ADR-0006: Per-Service Audit Trail, and Its Fragmentation Cost

**Status:** Accepted (reconstructed) — **contains an open issue**
**Date:** Undated — reconstructed from source at commit `ec4484c`

---

## Context

[ADR-0002](./ADR-0002-database-per-service.md) established that each service
owns its own database. That decision has a direct consequence for auditing:
if a change to a Marketing quotation needs an audit entry, that entry must be
written to `akura_marketing` — the same database as the change, so it can
commit atomically with it.

The alternative — a central audit service that every service calls — would
break that atomicity: the audit write would be a separate transaction against a
separate database, so the change and its audit entry could diverge.

The atomicity requirement is non-negotiable, and the source states it
explicitly:

> *"The write must run inside the same transaction as the change it describes,
> so the audit trail and the data can never disagree: either both are
> committed, or neither is."*
> — `marketing-service/src/utils/audit.ts:60-66`

## Decision

**Each service writes its own audit trail, in its own database, inside the
same transaction as the change it describes.**

| Service | Tables | Scope |
|---|---|---|
| app-manager | `audit_logs` | Menus, menu items, menu accesses, office branches |
| marketing | `audit_logs`, `catalog_audit_logs` | Companies, staff, services, items, contracts, quotations, taxes |
| fieldservice | `audit_logs` | Work orders |
| finance | *(none)* | — |

Each service exposes a read API over **its own** rows.

### Implementation

The shared shape is a `recordAudit(tx, input)` helper that takes a
`Prisma.TransactionClient` and writes one row:

```ts
await tx.auditLog.create({
  data: { module, entityType, entityId, version: BigInt(input.version),
    action, before, after, officeBranchId, createdById, createdByName },
});
```

**VERIFIED** — App Manager has the same helper with the same transactional
contract (`app-manager-service/src/utils/audit.ts`), called with `tx` inside
every repository mutation.

**System-initiated changes are attributed to a sentinel actor**, not to a user:

```ts
export const SYSTEM_ACTOR = { id: '00000000-0000-4000-8000-000000000000', name: 'System' };
export const serviceActor = (name: string) => ({ id: '00000000-0000-4000-8000-000000000001', name });
```

A replicated tax snapshot has no human actor, so the sending service is named
instead (`marketing-service/src/modules/taxes/tax-events.routes.ts:38-40`).

## Consequences

**Positive**

- **Atomic.** The audit entry and the change commit or roll back together.
  There is no window in which a change exists without its audit entry.
- **No cross-service dependency for writes.** A service never blocks on an
  audit service being available.
- **The trail follows the data.** Each trail lives with the data it describes,
  so it can be queried with the same transaction and the same indexes.
- **Retries are safe.** Marketing's `@@unique([entityType, entityId, version])`
  makes a repeated write a no-op rather than a duplicate entry.

**Negative**

- **The trail is fragmented.** No endpoint returns a platform-wide view.
- **The endpoint name over-promises.** `GET /api/v1/app-manager/audit-trail`
  implies a platform-wide trail, but it reads only `akura_app_manager`.
  Marketing's entries — the vast majority of business activity — are not
  visible through it.
- **The two schemas have drifted.** Marketing constrains the vocabulary with
  TypeScript unions; App Manager uses free-form `VarChar(50)`.
- **The uniqueness semantics differ.** Marketing enforces
  `@@unique([entityType, entityId, version])`; App Manager deliberately does
  not, because entities without a version column record a millisecond
  timestamp and *"Two writes to the same entity inside one millisecond would
  collide on a unique constraint and fail the write."*
- **Cross-service investigations require N queries** and application-level
  merging, with no shared correlation other than `x-request-id`.

## Open issue — the fragmentation gap

**This is the highest-severity finding in the platform.**

**Verified facts:**

1. `GET /api/v1/app-manager/audit-trail` reads only
   `app-manager-service`'s `audit_logs`
   (`app-manager-service/src/modules/audit-trail/audit-trail.repository.ts:42-73`).
2. Marketing writes `audit_logs` and `catalog_audit_logs` in `akura_marketing`
   (`marketing-service/src/utils/audit.ts:81`,
   `marketing-service/src/utils/catalogAudit.ts:16`).
3. **Nothing aggregates them.** There is no federated query, no export, and no
   replication of App Manager's entries into Marketing or vice versa.
4. Finance has **no audit trail at all** — tax changes are recorded in
   `TaxRevision` and `TaxEvent`, but not in an `audit_logs` table.

**Options, in increasing order of effort:**

| Option | Effort | Outcome |
|---|---|---|
| **A. Rename the endpoint** | Low | `GET /api/v1/app-manager/audit-trail` → something that says "App Manager". Honest, but does not solve the underlying need. |
| **B. Add a per-service audit read endpoint to each service** | Medium | Each service exposes its own trail; the client aggregates. Matches the current architecture. |
| **C. Publish audit entries as events** | Medium-High | Each service emits audit entries to a shared sink; a new read service aggregates them. Preserves atomicity (the event is written in the same transaction). |
| **D. Central audit service** | High | A dedicated service owns the trail; producers write to it. **Breaks the atomicity guarantee** — this is why it was not chosen originally. |

**Assessment:** Option **C** is the one that satisfies both requirements —
atomic writes *and* a platform-wide view — because the outbox pattern already
used elsewhere can carry audit entries without introducing a synchronous
dependency. It would reuse the machinery described in
[ADR-0003](./ADR-0003-http-outbox-over-message-broker.md).

**No option has been chosen.** This ADR records the decision as it stands and
the gap as it stands; it does not resolve it.

## Evidence

| Claim | Location |
|---|---|
| Atomicity requirement | `marketing-service/src/utils/audit.ts:60-66` |
| `recordAudit` implementation | `marketing-service/src/utils/audit.ts:67-97` |
| App Manager's equivalent | `app-manager-service/src/utils/audit.ts` |
| Audit read query (App Manager only) | `app-manager-service/src/modules/audit-trail/audit-trail.repository.ts:42-73` |
| Marketing's two audit tables | `marketing-service/src/utils/audit.ts:81`, `marketing-service/src/utils/catalogAudit.ts:16` |
| System/service actors | `marketing-service/src/utils/audit.ts:21-28` |
| Marketing uniqueness constraint | `marketing-service/prisma/schema.prisma` — `AuditLog @@unique([entityType, entityId, version])` |
| App Manager uniqueness rationale | `app-manager-service/prisma/schema.prisma` — `AuditLog` model comment |
| Module taxonomy divergence | `marketing-service/src/utils/audit.ts:35-48` vs `app-manager-service/prisma/schema.prisma` (`VarChar(50)`) |

## Related

- [ADR-0002](./ADR-0002-database-per-service.md) — the decision that forces per-service trails
- [ADR-0003](./ADR-0003-http-outbox-over-message-broker.md) — the mechanism Option C would reuse
- [`../database-and-data-ownership.md`](../database-and-data-ownership.md) — §5.3–5.5 cover the conflicts

