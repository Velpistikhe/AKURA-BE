# Field Service

Express/TypeScript service for Work Order. Default port: 5005. Gateway prefix: `/api/v1/fieldservice`.

Configure `.env` from `.env.example`, run `npm ci`, and run `npm run build`. Use `npm run dev` for development or `npm start` for compiled code. Configure the matching Field Service URL and gateway secret in API Gateway.

Run `npm test` for the service boundary and Work Order integration checks.

Development direct access: set `DIRECT_MFE_ACCESS=true` and `DIRECT_MFE_ORIGIN` to the browser Shell origin (usually `http://localhost:4173`). The local MFE then calls `/fieldservice/*` on `localhost:5005` with `Authorization: Bearer` instead of the gateway. Direct access is valid only in `NODE_ENV=development`, never on Vercel; a wrong gateway secret is still rejected and `/health` remains gateway-only. JWT, active profile, section/role, and branch checks are unchanged. Keep it disabled in production and use the API Gateway.

## Work Orders

Endpoint: `/api/v1/fieldservice/work-orders` through the gateway. GET/POST collection, GET/PATCH/DELETE `/:id`, and POST `/:id/start` (DRAFT to IN_PROGRESS). Access requires an active profile and matching authenticated branch. POST, DELETE and start require section MARKETING; PATCH permits sections MARKETING and FIELD_SERVICE. ADMIN/APP_MANAGER roles do not bypass these write restrictions. GET permits MARKETING/FIELD_SERVICE sections and ADMIN/APP_MANAGER roles. Section is loaded from Auth, never from client-submitted fields or headers.

Four tables: `work_order` (work order and document snapshots), `work_order_inspectors` (ordered inspector names linked to the work order), `work_order_sequences` (last allocated integer keyed by branch and year), and `work_order_histories` (append-only changes). For a fresh database use `npm run db:push`.

Create example:
```json
{
  "quotationId": "00000000-0000-4000-8000-000000000009",
  "startDate": "2026-09-15",
  "endDate": "2026-09-18",
  "inspectors": ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"]
}
```

`startDate` is required. `endDate` is nullable for contract-based orders but required for quotation-based orders; it cannot precede startDate. Status defaults to DRAFT; accepted values: DRAFT, IN_PROGRESS, COMPLETED, CANCELED. Creation never accepts status, and PATCH rejects `status: IN_PROGRESS` (400): the DRAFT to IN_PROGRESS transition only happens through `POST /:id/start` (see below), so no client can skip the Marketing snapshot validation. COMPLETED and CANCELED remain plain PATCH labels. Quotation-based creation also requires the `inspectors` array of `{ "userId": <uuid>, "name": "<firstName lastName>" }` pairs copied from the inspector options snapshot (which may be empty); `userId` values must be unique. After every other validation passes, Field Service re-validates every pair inside the same creation transaction against the `FieldServiceUser` read model of the authenticated branch: the submitted `name` must exactly equal the snapshot display name (`firstName lastName` from the user JSON), and the confirmed `userId` + `name` are stored into `work_order_inspectors`. Unknown or out-of-branch IDs and name mismatches return 400, and the Work Order is always created with status `DRAFT`; a rejected resolution rolls the whole creation (including number allocation) back. Reads and history stay name-based even after a user later changes name or leaves the branch. Use `GET /api/v1/fieldservice/options/inspectors` to list valid IDs. PATCH keeps the display-name array contract (`inspectors: ["Name"]`, rows written before ID capture keep `user_id` null); [] clears the list.

For contract-based orders, set exactly one of `contractId` or `companyId` instead; contract and quotation version values are never submitted. `summary` is not part of the Work Order model. Quotation content is resolved live from the Marketing quotation reference at creation and stored in the Work Order's own `quotationSnapshot` column.


Number (`WO/YYYY/000001`) and document date are generated together using Asia/Jakarta after locking the branch/year counter. Sequence resets at January 1 and increments independently per branch. Failed writes roll back allocation; revoked numbers are never reused. Missing counters recover from matching existing Work Order numbers. Clients cannot supply number, date, branch, revoked or audit fields.

PATCH and DELETE require `version`. Competing writes return one success and 409 for stale requests. PATCH `inspectors` replaces the full list atomically; [] clears it. DELETE sets revoked=true and preserves inspectors. GET detail includes revoked records; list defaults to revoked=false, with `revoked=true` for archived records. Other list filters: page, limit, status, quotationId, search (number/summary). All reads and writes remain branch scoped. Work Order and inspector writes share a transaction; the parent stores creator/updater ID and name plus timestamps.

Run `npm run test:work-order` after generation/schema setup. Swagger includes the Work Order request and response schemas.


### Work Order history

`GET /api/v1/fieldservice/work-orders/:id/history?page=1&limit=20` returns changes newest version first, within the authenticated branch, including revoked work orders. Following the same history pattern as other service modules, each entry exposes `actionLabel` (English), `changedBy` `{ id, name }`, `changedAt`, and `changes` entries with English `label` plus `before`/`after` values. Each CREATE, UPDATE, START and REVOKE saves the actor ID/name, timestamp, version, full before/after snapshots including inspectors, and the field-level changes array. Inspector changes compare names and order; generated row IDs do not create noisy change entries. Work Order, inspectors, sequence allocation and history commit together; a history failure rolls everything back. One history record per Work Order/version is enforced by a unique index. No history edit/delete endpoint is exposed.

The old report/documents HTTP modules and Prisma models have been removed. Existing `reports` and `reports_histories` database tables remain archived; this change does not drop historical data. Use the additive schema script on existing databases instead of accepting destructive `db:push` changes.

Application names use WorkOrder and `/work-orders`. Existing numbers and history are preserved; new numbers use WO and continue the existing branch/year counter.


### Document basis

Every new work order requires exactly one basis: `quotationId` (APPROVED quotation in this branch resolved live from `/api/v1/marketing/quotation-references/:quotationId`, with no version submitted), `contractId` (exact ACTIVE contract validated through the Marketing contract reference, branch-scoped), or `companyId` (server resolves an ACTIVE contract for the non-revoked company effective today in Asia/Jakarta; effectiveUntil is exclusive, matching Marketing). The quotation basis is resolved live through Marketing on every create and PATCH: 404 when Marketing does not expose the quotation (inactive, revised or never approved), 409 when it is not APPROVED or is contract priced, and 503 when Marketing is unreachable. Contract data is fetched through `/api/v1/marketing/company-contract-references/:companyId` or `/api/v1/marketing/contract-references/:contractId`; its ID and contractSnapshot are saved and included in history. Companies with no eligible contract or multiple eligible contracts return 409. Upstream unavailability returns 503 without creating a work order. Work orders without a basis are rejected. PATCH may replace the basis by supplying `companyId`, `contractId` or `quotationId`, which clears the opposite references. A quotation may back only one live (non-revoked) work order per branch: creating another work order, or re-pointing an existing one on PATCH, while a non-revoked work order already references the same quotation returns 409 with the blocking work order number. Only revoking that work order (DELETE, soft delete `revoked=true`) frees the quotation again, regardless of its status (`DRAFT`, `IN_PROGRESS`, `COMPLETED`, `CANCELED`). The check runs inside the creation/update transaction under a per-branch, per-quotation advisory lock, so concurrent creations for the same quotation cannot both pass it. Omitting all basis fields preserves it; clearing without replacement is rejected. Existing independent work orders remain readable. New work orders are always created with status `DRAFT`.

Physical tables are now `work_order`, `work_order_inspectors`, `work_order_sequences`, `work_order_histories`, with `work_order_id` foreign keys and `WorkOrderStatus` enum. Existing databases have been migrated; fresh databases use `npm run db:push`. Restart running consumers after applying schema changes.


### Start work order: DRAFT to IN_PROGRESS

`POST /api/v1/fieldservice/work-orders/:id/start` with body `{ "version": <current version> }` (section MARKETING) moves a work order to `IN_PROGRESS` and appends a `START` history entry. It is the only way to reach `IN_PROGRESS`; PATCH rejects `status: IN_PROGRESS` with 400. The version is the optimistic lock: a stale version or a work order that is no longer a draft returns 409, an unknown id 404, and a revoked work order 409.

Before a DRAFT work order starts, Field Service re-validates each stored inspector `userId` and display-name snapshot against Auth at `/api/v1/auth/users/field-service/inspectors?ids=<comma-separated-uuids>`. Auth only returns active FIELD_SERVICE users in the authenticated branch. If an inspector no longer exists there (deactivated, moved branch/section, or removed), or the display name differs from the stored snapshot, start returns 409 and the status remains DRAFT. Auth network errors, timeouts, or 5xx return 503. Legacy name-only rows with `user_id=null` do not have an ID to revalidate. The request happens before the status transaction, so upstream calls never hold database locks.

For a quotation-based work order the stored `quotationSnapshot` is also re-validated against the live Marketing quotation through `/api/v1/marketing/quotation-references/:quotationId` before the transaction starts:

- Marketing unreachable (network error, timeout or 5xx) returns 503 `Marketing service is currently unavailable; retry later`.
- A quotation that no longer matches Marketing (version changed, revised, deactivated, not APPROVED, contract-priced, or removed so Marketing answers 404) returns 409 `Work order quotation snapshot does not match Marketing data; reload the quotation`.
- When the snapshot matches, the transition commits atomically: status, version increment, updated-by actor and history.

Every Marketing content mutation bumps the quotation version, so version equality is authoritative; the comparison additionally checks id, branch, status, isActive, subject and totals against the stored snapshot. Contract/company-based work orders start without any Marketing quotation call.



### Field Service user read model and option endpoints

Two additional tables store synchronized users: `field_service_users` (one row per eligible user; the complete Auth snapshot lives in a single `user` JSONB column plus `office_branch_id` and source version/timestamps) and `field_service_user_sync_revisions` (last processed version per user so reordered retries cannot resurrect a removed row).

`POST /api/v1/fieldservice/internal/users/events` (through the gateway with Auth service credentials) receives user snapshots. The header `x-user-sync-secret` must match `USER_SYNC_SECRET` shared with Auth. A row is stored only when the snapshot is active, has section `FIELD_SERVICE` and an assigned office branch; otherwise the local row is deleted. Duplicate or older versions are acknowledged without changing the local read model, under an advisory lock. Delivery uses the Auth outbox with retry, exactly like the Marketing receiver.

Two option endpoints read these local tables, both requiring an active profile with a matching authenticated branch:

- `GET /api/v1/fieldservice/options/inspectors` returns `{ inspectors: [<user snapshot JSON apa adanya>] }`: setiap elemen adalah isi kolom JSON `user` milik `field_service_users` (snapshot Auth lengkap, termasuk `id`, `username`, `firstName`, `lastName`, `email`, `telp`, `role`, `section`, `officeBranchId`, `isActive`, `version`, `createdAt`, `updatedAt`), ordered by user creation time then ID, limited to 500 rows.
- `GET /api/v1/fieldservice/options/quotations` resolves the branch-scoped list live from `GET /api/v1/marketing/quotation-references` in a single upstream request; Marketing already returns only active APPROVED non-contract-priced quotations of the authenticated branch, ordered by approval time descending and capped at 1000 rows. Marketing unavailable returns 503.
