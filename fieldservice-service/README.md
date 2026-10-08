# Field Service

Express/TypeScript service for Work Order. Default port: 5005. Gateway prefix: `/api/v1/fieldservice`.

Configure `.env` from `.env.example`, run `npm ci`, and run `npm run build`. Use `npm run dev` for development or `npm start` for compiled code. Configure the matching Field Service URL and gateway secret in API Gateway.

Run `npm test` for the service boundary and Work Order integration checks.

Development direct access: set `DIRECT_MFE_ACCESS=true` and `DIRECT_MFE_ORIGIN` to the browser Shell origin (usually `http://localhost:4173`). The local MFE then calls `/fieldservice/*` on `localhost:5005` with `Authorization: Bearer` instead of the gateway. Direct access is valid only in `NODE_ENV=development`, never on Vercel; a wrong gateway secret is still rejected and `/health` remains gateway-only. JWT, active profile, section/role, and branch checks are unchanged. Keep it disabled in production and use the API Gateway.

## Work Orders

Endpoint: `/api/v1/fieldservice/work-orders` through the gateway. GET/POST collection and GET/PATCH/DELETE `/:id`. Access requires an active profile and matching authenticated branch. POST and DELETE require section MARKETING; PATCH permits sections MARKETING and FIELD_SERVICE. ADMIN/APP_MANAGER roles do not bypass these write restrictions. GET permits MARKETING/FIELD_SERVICE sections and ADMIN/APP_MANAGER roles. Section is loaded from Auth, never from client-submitted fields or headers.

Five tables: `work_order` (work order and document snapshots), `work_order_inspectors` (ordered inspector names linked to the work order), `work_order_sequences` (last allocated integer keyed by branch and year), `work_order_histories` (append-only changes), and `quotation_snapshots` (latest approved quotation JSON per branch and quotation). For a fresh database use `npm run db:push`.

Create example:
```json
{
  "quotationId": "00000000-0000-4000-8000-000000000009",
  "startDate": "2026-09-15",
  "endDate": "2026-09-18",
  "inspectors": ["Budi Santoso", "Agus Wijaya"]
}
```

`startDate` is required. `endDate` is nullable for contract-based orders but required for quotation-based orders; it cannot precede startDate. Status defaults to DRAFT; accepted values: DRAFT, IN_PROGRESS, COMPLETED, CANCELED. Status is a CRUD label, not an approval workflow. Quotation-based creation also requires the `inspectors` array (which may be empty); inspector names are ordered and unique ignoring case. No Auth account is required for an inspector name.

For contract-based orders, set exactly one of `contractId` or `companyId` instead; contract and quotation version values are never submitted. `summary` is not part of the Work Order model. Quotation content is read from `quotation_snapshots`, populated by Marketing when a quotation is approved; Work Order creation does not fetch quotation data live.


Number (`WO/YYYY/000001`) and document date are generated together using Asia/Jakarta after locking the branch/year counter. Sequence resets at January 1 and increments independently per branch. Failed writes roll back allocation; revoked numbers are never reused. Missing counters recover from matching existing Work Order numbers. Clients cannot supply number, date, branch, revoked or audit fields.

PATCH and DELETE require `version`. Competing writes return one success and 409 for stale requests. PATCH `inspectors` replaces the full list atomically; [] clears it. DELETE sets revoked=true and preserves inspectors. GET detail includes revoked records; list defaults to revoked=false, with `revoked=true` for archived records. Other list filters: page, limit, status, quotationId, search (number/summary). All reads and writes remain branch scoped. Work Order and inspector writes share a transaction; the parent stores creator/updater ID and name plus timestamps.

Run `npm run test:work-order` after generation/schema setup. Swagger includes the Work Order request and response schemas.


### Work Order history

`GET /api/v1/fieldservice/work-orders/:id/history?page=1&limit=20` returns changes newest version first, within the authenticated branch, including revoked work orders. Following the same history pattern as other service modules, each entry exposes `actionLabel` (English), `changedBy` `{ id, name }`, `changedAt`, and `changes` entries with English `label` plus `before`/`after` values. Each CREATE, UPDATE and REVOKE saves the actor ID/name, timestamp, version, full before/after snapshots including inspectors, and the field-level changes array. Inspector changes compare names and order; generated row IDs do not create noisy change entries. Work Order, inspectors, sequence allocation and history commit together; a history failure rolls everything back. One history record per Work Order/version is enforced by a unique index. No history edit/delete endpoint is exposed.

The old report/documents HTTP modules and Prisma models have been removed. Existing `reports` and `reports_histories` database tables remain archived; this change does not drop historical data. Use the additive schema script on existing databases instead of accepting destructive `db:push` changes.

Application names use WorkOrder and `/work-orders`. Existing numbers and history are preserved; new numbers use WO and continue the existing branch/year counter.


### Document basis

Every new work order requires exactly one basis: `quotationId` (APPROVED quotation in this branch resolved from `quotation_snapshots`, with no version submitted), `contractId` (exact ACTIVE contract validated through the Marketing contract reference, branch-scoped), or `companyId` (server resolves an ACTIVE contract for the non-revoked company effective today in Asia/Jakarta; effectiveUntil is exclusive, matching Marketing). The quotation basis is populated by the internal snapshot delivery `POST /api/v1/fieldservice/internal/quotation-snapshots/events`, which Marketing enqueues outbox-style the moment a quotation is approved; a missing snapshot returns 404 until the quotation is approved and synchronized. Contract data is fetched through `/api/v1/marketing/company-contract-references/:companyId` or `/api/v1/marketing/contract-references/:contractId`; its ID and contractSnapshot are saved and included in history. Companies with no eligible contract or multiple eligible contracts return 409. Upstream unavailability returns 503 without creating a work order. Work orders without a basis are rejected. PATCH may replace the basis by supplying `companyId`, `contractId` or `quotationId`, which clears the opposite references. Omitting all basis fields preserves it; clearing without replacement is rejected. Existing independent work orders remain readable. New work orders are always created with status `DRAFT`.

Physical tables are now `work_order`, `work_order_inspectors`, `work_order_sequences`, `work_order_histories`, `quotation_snapshots`, with `work_order_id` foreign keys and `WorkOrderStatus` enum. Existing databases have been migrated; fresh databases use `npm run db:push`. Restart running consumers after applying schema changes.


### Quotation snapshot receiver

`POST /api/v1/fieldservice/internal/quotation-snapshots/events` (through the gateway with Marketing service credentials) stores the complete approved quotation JSON. The header `x-quotation-sync-secret` must match `QUOTATION_SYNC_SECRET` shared with Marketing; the gateway injects the Field Service gateway secret. Events carry eventId, branch, quotationId, quotationVersion, an event version, revision, approvedAt and the quotation object. Per-quotation replacement and version advancement are atomic under an advisory branch lock; duplicate or older events are acknowledged without changing the stored row. Acknowledgment is sent only after commit. Marketing commits the outbox event inside the approval transaction and retries delivery with exponential backoff, so a committed approval is never lost.

### Field Service user read model and option endpoints

Two additional tables store synchronized users: `field_service_users` (one row per eligible user; the complete Auth snapshot lives in a single `user` JSONB column plus `office_branch_id` and source version/timestamps) and `field_service_user_sync_revisions` (last processed version per user so reordered retries cannot resurrect a removed row).

`POST /api/v1/fieldservice/internal/users/events` (through the gateway with Auth service credentials) receives user snapshots. The header `x-user-sync-secret` must match `USER_SYNC_SECRET` shared with Auth. A row is stored only when the snapshot is active, has section `FIELD_SERVICE` and an assigned office branch; otherwise the local row is deleted. Duplicate or older versions are acknowledged without changing the local read model, under an advisory lock. Delivery uses the Auth outbox with retry, exactly like the Marketing receiver.

Two option endpoints read these local tables, both requiring an active profile with a matching authenticated branch:

- `GET /api/v1/fieldservice/options/inspectors` returns `{ inspectors: [{ id, name, username }] }` from `field_service_users`, ordered by user creation time then ID, limited to 500 rows.
- `GET /api/v1/fieldservice/options/quotations` returns `{ quotations: [...] }` from `quotation_snapshots` (no live Marketing call), filtered to active APPROVED quotations and excluding contract-priced quotations (those must use the contract basis). Ordered by approval time descending, limited to 1000 rows.
