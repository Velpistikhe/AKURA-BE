# Data deletion policy

Public DELETE endpoints retain business/configuration rows. Deletion uses the
existing lifecycle marker (`isActive`, `revoked`, or `isDeleted`), validates
ownership and dependencies, and commits changes atomically. Existing request
formats and business lifecycle rules remain in place.

| Service | Resources | Marker and validation |
| --- | --- | --- |
| App Manager | Menus, menu items, access rules | `isDeleted=true`; menus/items also set `isActive=false`. Reject parent deletion while undeleted children exist. All hierarchy writes share a transaction advisory lock. Global configuration requires APP_MANAGER, rather than a branch. |
| Marketing | Services, items, sizes, contract prices | `isActive=false`; current version, branch, catalog locks and audit history. Existing standard-price deactivation rules remain; contract snapshots are preserved. |
| Marketing | Inspection and maintenance scopes | `revoked=true`; validate branch through the service, active parent and undeleted scope under the catalog branch lock; increment parent version and append audit. No new request body is required. |
| Marketing | Company staff | `revoked=true`; current version, company branch, branch lock and history. |
| Marketing | Quotations and quotation items | `isActive=false`; current versions, branch, lifecycle and history. Quotation deletion rejects active Work Orders using local linkage plus live Field Service validation. Field Service failure prevents deletion. |
| Marketing | Company contracts | `isDeleted=true`; only DRAFT/REJECTED, current version, branch lock and history; repeated deletion is rejected. |
| Field Service | Work Orders | `revoked=true`; current version, branch, permitted lifecycle and history. A quotation-based order must notify Marketing successfully before commit. |
| Finance | Proforma invoices and invoices | `isActive=false`; current version, document kind, branch and history in the same transaction. |
| Auth | None | No public data DELETE endpoint exists. Logout/token revocation remains an authentication lifecycle operation. |
| API Gateway | None | Proxies requests and publishes the API contract; owns no deletable business data. |

Invalid input returns 400 (or the existing validation status), missing or
other-branch records return 404, lifecycle/dependency/version conflicts return
409, and unavailable required upstream validation returns 503. Success returns
200 with the existing response envelope. Deleted resources stay available to
existing history APIs; active lists and reference/permission lookups exclude them.

App Manager does not yet accept client versions for menu writes. Its shared
transaction lock serializes create, update and delete, including parent checks.
Other resources retain their existing version contracts. Deletion markers are
server-controlled; PATCH cannot restore a deleted menu record. Unique menu keys
and access-rule identities remain reserved, including after deletion.

Internal synchronized user read models and replaceable tax caches still remove
obsolete cache rows physically; these are projections, not public data deletion
endpoints. Inspector replacement similarly replaces child rows inside an audited
Work Order update. Soft-deleting these projections would leave stale active
reference/authorization data unless their synchronization protocol were changed.

## App Manager deployment

Apply `app-manager-service/prisma/soft-delete-menus.sql` to the App Manager
database before deploying the new service. The script only adds three boolean
columns with false defaults, preserves existing rows and is safe to re-run.
Alternatively, in development, use the project's Prisma schema push workflow.
Generate Prisma Client/build after updating the schema. Deploy the API Gateway
alongside affected services to publish the updated Swagger documentation.

No database schema or deployment is modified automatically by the application.
