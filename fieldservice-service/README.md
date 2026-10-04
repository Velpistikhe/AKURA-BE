# Field Service

Express/TypeScript service for Work Order. Default port: 5005. Gateway prefix: `/api/v1/fieldservice`.

Configure `.env` from `.env.example`, run `npm ci`, and run `npm run build`. Use `npm run dev` for development or `npm start` for compiled code. Configure the matching Field Service URL and gateway secret in API Gateway.

Run `npm test` for the service boundary and Work Order integration checks.

Development direct access: set `DIRECT_MFE_ACCESS=true` and `DIRECT_MFE_ORIGIN` to the browser Shell origin (usually `http://localhost:4173`). The local MFE then calls `/fieldservice/*` on `localhost:5005` with `Authorization: Bearer` instead of the gateway. Direct access is valid only in `NODE_ENV=development`, never on Vercel; a wrong gateway secret is still rejected and `/health` remains gateway-only. JWT, active profile, section/role, and branch checks are unchanged. Keep it disabled in production and use the API Gateway.

## Work Orders

Endpoint: `/api/v1/fieldservice/work-orders` through the gateway. GET/POST collection and GET/PATCH/DELETE `/:id`. Access requires an active profile and matching authenticated branch. POST and DELETE require section MARKETING; PATCH permits sections MARKETING and FIELD_SERVICE. ADMIN/APP_MANAGER roles do not bypass these write restrictions. GET permits MARKETING/FIELD_SERVICE sections and ADMIN/APP_MANAGER roles. Section is loaded from Auth, never from client-submitted fields or headers.

Four tables: `work_order` (work order, optional quotation snapshot and audit), `work_order_inspectors` (ordered inspector names linked to the work order), `work_order_sequences` (last allocated integer keyed by branch and year), and `work_order_histories` (append-only changes). For a fresh database use `npm run db:push`.

Create example:
```json
{
  "companyId": "00000000-0000-4000-8000-000000000001",
  "startDate": "2026-09-15",
  "endDate": "2026-09-18",
  "summary": "Tubular inspection at customer site",
  "inspectors": ["Budi Santoso", "Agus Wijaya"]
}
```

`startDate` and `summary` are required. `endDate` is optional/null and cannot precede startDate. Status defaults to DRAFT; accepted values: DRAFT, IN_PROGRESS, COMPLETED, CANCELED. Status is a CRUD label, not an approval workflow. Inspector names are optional, ordered and unique ignoring case. No Auth account is required for an inspector name.

Supply exactly one quotation/version pair or companyId; see Document basis below.

Number (`WO/YYYY/000001`) and document date are generated together using Asia/Jakarta after locking the branch/year counter. Sequence resets at January 1 and increments independently per branch. Failed writes roll back allocation; revoked numbers are never reused. Missing counters recover from matching existing Work Order numbers. Clients cannot supply number, date, branch, revoked or audit fields.

PATCH and DELETE require `version`. Competing writes return one success and 409 for stale requests. PATCH `inspectors` replaces the full list atomically; [] clears it. DELETE sets revoked=true and preserves inspectors. GET detail includes revoked records; list defaults to revoked=false, with `revoked=true` for archived records. Other list filters: page, limit, status, quotationId, search (number/summary). All reads and writes remain branch scoped. Work Order and inspector writes share a transaction; the parent stores creator/updater ID and name plus timestamps.

Run `npm run test:work-order` after generation/schema setup. Swagger includes the Work Order request and response schemas.


### Work Order history

`GET /api/v1/fieldservice/work-orders/:id/history?page=1&limit=20` returns changes newest version first, within the authenticated branch, including revoked work orders. Following the same history pattern as other service modules, each entry exposes `actionLabel` (English), `changedBy` `{ id, name }`, `changedAt`, and `changes` entries with English `label` plus `before`/`after` values. Each CREATE, UPDATE and REVOKE saves the actor ID/name, timestamp, version, full before/after snapshots including inspectors, and the field-level changes array. Inspector changes compare names and order; generated row IDs do not create noisy change entries. Work Order, inspectors, sequence allocation and history commit together; a history failure rolls everything back. One history record per Work Order/version is enforced by a unique index. No history edit/delete endpoint is exposed.

The old report/documents HTTP modules and Prisma models have been removed. Existing `reports` and `reports_histories` database tables remain archived; this change does not drop historical data. Use the additive schema script on existing databases instead of accepting destructive `db:push` changes.

Application names use WorkOrder and `/work-orders`. Existing numbers and history are preserved; new numbers use WO and continue the existing branch/year counter.


### Document basis

Every new work order requires exactly one basis: `quotationId` + `quotationVersion` (active APPROVED quotation using normal/sister company prices), `contractId` + `contractVersion` (exact ACTIVE contract validated through the Marketing contract reference, branch-scoped), or `companyId` (server resolves an ACTIVE contract for the non-revoked company effective today in Asia/Jakarta; effectiveUntil is exclusive, matching Marketing). The work order can therefore be created directly from the frontend on this service, or forwarded by Marketing after a quotation is selected; both paths converge on the same validation. Companies with no eligible contract or multiple eligible contracts return 409. Upstream unavailability returns 503 without creating a work order. Work orders without a basis are rejected. PATCH may replace the basis by supplying `companyId` or exactly one quotation/contract ID/version pair, which clears the opposite references. Omitting all basis fields preserves it; clearing without replacement is rejected. Contract data is fetched through `/api/v1/marketing/company-contract-references/:companyId` or `/api/v1/marketing/contract-references/:contractId`; its ID, version and contractSnapshot are saved and included in history. Existing independent work orders remain readable. New work orders are always created with status `DRAFT`.

Physical tables are now `work_order`, `work_order_inspectors`, `work_order_sequences`, `work_order_histories`, with `work_order_id` foreign keys and `WorkOrderStatus` enum. Existing databases have been migrated; fresh databases use `npm run db:push`. Restart running consumers after applying schema changes.
