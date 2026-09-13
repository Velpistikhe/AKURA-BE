# Field Service Service

Express/TypeScript service with quotation-linked document modules. Default port: 5005. Gateway prefix: `/api/v1/fieldservice`.

## Local setup

1. Run `npm ci` in this directory.
2. Copy `.env.example` to `.env` and configure a unique `GATEWAY_SECRET`.
3. Set `FIELDSERVICE_SERVICE_URL=http://localhost:5005` and `FIELDSERVICE_SERVICE_GATEWAY_SECRET` in the gateway environment. Both must be configured together; the secret must match this service and differ from other services.
4. Run `npm run dev` and restart the gateway.

`GET /api/v1/fieldservice/health` through the gateway requires a valid access token. Direct `/health` requires the service gateway secret and reports process liveness only. JWT validation for domain routes uses the Auth JWKS through the gateway; forwarded identity headers are not trusted as authentication.

Commands: `npm run build`, `npm start`, `npm run typecheck`, `npm test`.

Domain routes belong in `src/modules` and are registered in `src/routes/index.ts`. Authentication is applied before the router. The service owns its PostgreSQL database. Set DATABASE_URL to its own database, run npm run db:push, then npm run build. Never point DATABASE_URL at another service database. Swagger is maintained in `api-gateway/src/docs/operational-documents.ts` and `openapi.ts`.


## Quotation-linked documents

`/reports` uses the reports table and report histories.

Each module supports GET/POST at its collection, GET/PATCH/DELETE at `/:id`, and GET `/:id/history`. Lists support page, limit, quotationId, status and search (number/title). History supports page and limit, newest first, and remains accessible after soft deletion.

Create fields: `quotationId`, `quotationVersion`, `number`, `title`, `date` (YYYY-MM-DD), optional `notes` and `status` (DRAFT default or FINAL). Reports additionally require plain-text `content` (1?100000 characters).

The quotation ID and snapshot are immutable after creation. One quotation may have multiple documents. Finance uses the full quotation amount, not partial billing. Document numbers are supplied by the user, uppercased, and unique per branch and document kind even after deletion. FINAL is a document label in this CRUD module, not an accounting posting or approval workflow.

PATCH and DELETE require the latest `version`; stale or competing mutations return 409. Both accept an optional `reason`. Writes and append-only history share a local transaction. History contains English action labels, actor ID/name, timestamps, field labels, before/after values, reason and full snapshots.

The service verifies the current active Auth profile through Gateway and derives officeBranchId from that profile. It never trusts client-supplied branch or user headers. Quotation lookup is branch scoped, verifies the requested quotationVersion and fails closed on upstream errors. No foreign key or direct query crosses databases. The saved quotation snapshot is the state observed at validation time, not a distributed lock; later quotation edits/deletion preserve existing documents.

No invoiceStatus updates are sent automatically to Marketing. No automatic invoice, proforma, report, contract or payment is generated.

Run `npm test` and `npm run test:documents` after setting up the database. Document tests use isolated random branches and remove only their fixtures. They exercise cross-branch rejection, snapshot persistence, 12 competing updates, atomic history, soft deletion and upstream validation.

Access is limited to ADMIN/APP_MANAGER or FIELD_SERVICE users. The JWT branch must match the current Auth profile; a changed assignment requires a fresh login. Quotation references use the read-only Marketing endpoint `/quotation-references/:quotationId`, accessible to relevant document sections within the same branch.

HTTP tests mount the real module routes with an injected token identity and mock Auth/Marketing responses. Persistence and concurrency tests use the local PostgreSQL database; they do not constitute a live end-to-end test across all running services.
