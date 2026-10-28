# Finance Service

Express/TypeScript service with quotation-linked document modules. Default port: 5004. Gateway prefix: `/api/v1/finance`.

## Local setup

1. Run `npm ci` in this directory.
2. Copy `.env.example` to `.env` and configure a unique `GATEWAY_SECRET`.
3. Set `FINANCE_SERVICE_URL=http://localhost:5004` and `FINANCE_SERVICE_GATEWAY_SECRET` in the gateway environment. Both must be configured together; the secret must match this service and differ from other services.
4. Run `npm run dev` and restart the gateway.

`GET /api/v1/finance/health` through the gateway requires a valid access token. Direct `/health` requires the service gateway secret and reports process liveness only. JWT validation for domain routes uses the Auth JWKS through the gateway; forwarded identity headers are not trusted as authentication.

Development setup: `DIRECT_MFE_ACCESS=true` permits the local Finance MFE to call `/finance/*` directly on `localhost:5004` with its Shell-provided Bearer token. Set `DIRECT_MFE_ORIGIN` to the browser Shell origin (usually `http://localhost:4173`). This option is valid only with `NODE_ENV=development` and is disabled on Vercel; internal service calls, health checks, and requests with an incorrect gateway secret remain protected. User JWT, active profile, section/role, and branch checks still apply. In production keep direct access disabled and use the API Gateway.

Commands: `npm run build`, `npm start`, `npm run typecheck`, `npm test`.

Domain routes belong in `src/modules` and are registered in `src/routes/index.ts`. Authentication is applied before the router. The service owns its PostgreSQL database. Set DATABASE_URL to its own database, run npm run db:push, then npm run build. Never point DATABASE_URL at another service database. Swagger is maintained in `api-gateway/src/docs/operational-documents.ts` and `openapi.ts`.


### Create invoice or proforma invoice from an approved quotation

Marketing can create a Finance document from the full approved quotation. The quotation snapshot is resolved server-side; clients choose the document kind, optional payment deadline, and notes:

`POST /api/v1/marketing/quotations/{quotationId}/invoices`

```json
{"kind":"INVOICE","dueDate":"2026-12-31","notes":"Payment due in 30 days"}
```

`kind` accepts `INVOICE` or `PROFORMA_INVOICE`. `dueDate` is nullable/optional and represents the payment deadline. Marketing requires an active quotation in the caller's branch and status `APPROVED`, then forwards all quotation lines with quantities, unit prices, discounts and subtotals to Finance.

Finance exposes `POST /api/v1/finance/invoices/from-marketing` and `POST /api/v1/finance/proforma-invoices/from-marketing`. These endpoints accept the full quotation snapshot, optional `dueDate` and `notes`; Finance re-fetches the quotation from Marketing using the forwarded access token and validates branch ownership, active/APPROVED status, version and billed line values before saving. Both kinds are created as `DRAFT`. Finance stores a header and detail lines with prices, and generates the document number, date, tax and totals. The deadline must not precede the document date. MARKETING users may access Finance document creation, lists, details, history, updates, deletion and approval, plus tax reads and delivery status. Tax creation and resync require ADMIN with section FINANCE or MARKETING. All operations remain branch-scoped.

Finance users approve a draft with `POST /api/v1/finance/{invoices|proforma-invoices}/{id}/approve` and body `{"version":0}`. This atomically changes `DRAFT` to `ON_PROGRESS` and appends an `APPROVE` history entry. Stale versions or non-draft documents return 409.

## Quotation-linked documents

`/proforma-invoices` and `/invoices` share the billing_documents table, distinguished by DocumentKind; each record owns its history.

Each module supports GET/POST at its collection, GET/PATCH/DELETE at `/:id`, and GET `/:id/history`. Lists support page, limit, quotationId, status and search (number/title). History supports page and limit, newest first, and remains accessible after soft deletion.

Invoice create fields: `quotationId`, `quotationVersion`, `title`, optional `notes` and `status` (DRAFT default or FINAL). Finance additionally accepts optional nullable `dueDate`; totals come from the quotation and cannot be supplied by clients.

The quotation ID and snapshot are immutable after creation. One quotation may have multiple documents. Finance uses the full quotation amount, not partial billing. Invoice numbers and dates are server-generated and rejected in POST/PATCH bodies. Numbers use `INV/YYYY/000001`, with an atomic `invoice_sequences` counter keyed by officeBranchId and year. The sequence restarts at 1 each January 1 in Asia/Jakarta. Invoice date uses the same Jakarta calendar day, captured after acquiring the counter lock. Counter, document, and history commit together; failures roll back allocation and soft deletion never frees a number. A missing counter is seeded from existing invoice numbers matching `INV/YYYY/<digits>`, including deleted invoices. Other legacy number formats are preserved. Proforma invoices require client-supplied `date`, while `number` is generated as `PI/YYYY/000001` using the separate `proforma_invoice_sequences` table keyed by officeBranchId and year. POST/PATCH reject number. The counter uses the Jakarta calendar year at creation, resets annually, and is independent of invoice; changing the proforma date does not change its number. Allocation, document and history share one transaction. Existing documents keep their numbers. FINAL is a document label in this CRUD module, not an accounting posting or approval workflow.

PATCH and DELETE require the latest `version`; stale or competing mutations return 409. Both accept an optional `reason`. Writes and append-only history share a local transaction. History contains English action labels, actor ID/name, timestamps, field labels, before/after values, reason and full snapshots.

The service verifies the current active Auth profile through Gateway and derives officeBranchId from that profile. It never trusts client-supplied branch or user headers. Quotation lookup is branch scoped, verifies the requested quotationVersion and fails closed on upstream errors. No foreign key or direct query crosses databases. The saved quotation snapshot is the state observed at validation time, not a distributed lock; later quotation edits/deletion preserve existing documents.

No invoiceStatus updates are sent automatically to Marketing. No automatic invoice, proforma, report, contract or payment is generated.

The invoice and proforma sequence tables are already applied to existing databases. Fresh databases use `npm run db:push`.

Run `npm test` and `npm run test:documents` after setting up the database. Document tests use isolated random branches and remove only their fixtures. They exercise cross-branch rejection, snapshot persistence, 12 competing updates, atomic history, soft deletion and upstream validation.

Access is available to MARKETING, FINANCE and ACCOUNTING users, plus existing ADMIN/APP_MANAGER access. The JWT branch must match the current Auth profile; a changed assignment requires a fresh login. Quotation references use the read-only Marketing endpoint `/quotation-references/:quotationId`, accessible to relevant document sections within the same branch.

HTTP tests mount the real module routes with an injected token identity and mock Auth/Marketing responses. Persistence and concurrency tests use the local PostgreSQL database; they do not constitute a live end-to-end test across all running services.

## Finance-owned tax and automatic delivery

Finance is the only master tax writer. Periods remain scoped by office branch. The gateway routes are:

- `GET /api/v1/finance/taxes`: paginated master periods (`page`, `limit`).
- `POST /api/v1/finance/taxes`: `{ "percentage": "11.25", "effectiveFrom": "2026-10-01" }`. Active ADMIN in FINANCE with a branch required. Closes the previous period and records an outbox event atomically.
- `GET /api/v1/finance/taxes/deliveries`: per-recipient attempts, next retry, last error and delivery timestamp.
- `POST /api/v1/finance/taxes/resync`: empty body; queues a fresh branch snapshot for bootstrap/recovery. Same write permissions.

Configure `TAX_SYNC_SECRET` identically on Finance and consumers, and `TAX_DELIVERY_TARGETS` as a JSON array of `{name,url}`. The URL points directly to Marketing `/internal/taxes/events`, over HTTPS/private network. Never expose the credential to browser clients. Changing a target URL preserves pending jobs because delivery resolves the configured URL by stable service name. Removing a target leaves its jobs pending until configuration is repaired.

After commit, Add Tax and Resync await a delivery attempt for their specific event before responding. New events are not held behind older pending events. Delivery sends `POST /internal/taxes/events` to each configured target with `x-tax-sync-secret` and a complete snapshot of the branch's tax periods. Marketing replaces that branch's `taxCache` and revision atomically; older and duplicate versions are ignored. Finance remains the source of master tax records.

HTTP delivery requests have a ten-second timeout and require `{success:true,eventId}` acknowledgment. Failures preserve the committed tax and outbox, increment attempts, record lastError, and use durable nextRetryAt with exponential backoff (10s, 20s, 40s, ... capped at 5m) plus jitter. Refreshing `GET /taxes/deliveries` awaits up to five due deliveries for the authenticated branch before returning current status. This works when Vercel imports the Express app without starting the timer worker. Concurrent invocations remain protected by transaction advisory locks.

Long-lived servers also run the timer worker and recover pending entries on startup. On Vercel, retries without incoming requests require a separate durable scheduler/queue; timers alone do not guarantee execution between requests. Refresh retries existing due entries, while Resync publishes a new snapshot. After deploying this fix, use Refresh or Resync to recover pending synchronization. Set the deployed Finance `TAX_DELIVERY_TARGETS` to the Marketing Vercel receiver and configure identical `TAX_SYNC_SECRET` values in both Vercel projects; changing local `.env` files does not update deployed environments. Allow sufficient function duration for the database transaction and delivery timeout.

Run `npm run test:tax-serverless` in Finance and `npm run test:tax-events-http` in Marketing for HTTP regression tests without production database writes. The existing `test:tax-delivery` and `test:tax-events` suites cover real database transaction behavior using isolated schemas.

Invoice/proforma creation reads Finance master tax effective on document date, serializes with branch tax writes, computes tax with Decimal half-up rounding to two decimals and saves taxSourceId/tax alongside amounts. A missing period returns 409. Proforma draft date changes and document finalization revalidate tax. Final documents cannot be edited; existing documents are not automatically repriced. Legacy tax snapshots remain null rather than guessing from historical amounts.

14. `POST /invoices/from-marketing` — create a DRAFT invoice from a Marketing-approved full quotation snapshot. Finance revalidates the branch, approval status, version and priced detail lines with Marketing using the forwarded token, and accepts an optional payment `dueDate`.
15. `POST /invoices/:id/approve` — Finance/Accounting approval transition from DRAFT to ON_PROGRESS. It requires the current `{version}` and records history atomically.
16. Equivalent endpoints exist under `/proforma-invoices/from-marketing` and `/proforma-invoices/:id/approve`. MARKETING-section users may access all Finance modules; tax writes and resync still require ADMIN in FINANCE or MARKETING.

### Cutover from App Manager

1. Configure delivery targets and the shared secret using `.env.example`. Stop the old App Manager tax writer and old Finance/Marketing scheduler processes before import.
2. Run `npm run db:generate` in Finance and Marketing for an existing database. For a new empty database use `npm run db:push`. Stop running service processes before Prisma generation on Windows to release the engine DLL. Build Finance.
3. Run `npm run tax:import` in Finance. It reads App Manager's local `.env` (or `APP_MANAGER_DATABASE_URL`), preserves IDs, dates and audit history, refuses conflicting Finance data and queues snapshots. It never changes the source database.
4. Start updated Marketing and Finance. The worker recovers queued events. Check `/taxes/deliveries`; source records stay archived in App Manager, whose tax endpoints are removed.
5. Point the UI to `/api/v1/finance/taxes`. For a new consumer, add its stable target name/URL, restart Finance and call `/taxes/resync` for each branch.

Swagger is served by API Gateway. Internal receiver documentation uses a direct Marketing server URL. Test using `npm run test:tax-delivery`.
