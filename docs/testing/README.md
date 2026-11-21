# Testing documentation

This folder holds the recorded results of the load and stress runs of the
Akura reliability suite. The suites themselves live in
`marketing-service/tests/`.

## Safety

The suite only ever talks to the local PostgreSQL instance and the local test
ports (5100-5105). The environment guard in
`marketing-service/tests/support/env.ts` refuses to start when a database URL
points at a remote host, so a run can never touch a deployed environment.

## Suite inventory

There are **16** `*.test.ts` files under `marketing-service/tests/`, numbered `00`–`16` with **no** `12-*.test.ts` (the sequence gap is intentional history, not a missing suite).

| File | Layer |
|---|---|
| `00-harness-smoke.test.ts` | Smoke — stack boots and gateway health |
| `01-functional-baseline.test.ts` | Functional — catalog CRUD and gateway-only internals |
| `02-concurrency-quotations.test.ts` | Concurrency — quotation writes |
| `03-stress-load.test.ts` | Stress — company list/create (writes `stress-report.json`) |
| `04-event-sync.test.ts` | Integration — Finance tax delivery to Marketing |
| `05-concurrency-auth.test.ts` | Concurrency — auth |
| `06-concurrency-app-manager.test.ts` | Concurrency — app manager menus |
| `07-concurrency-finance.test.ts` | Concurrency — finance taxes |
| `08-concurrency-fieldservice.test.ts` | Concurrency — field service reads |
| `09-environment.test.ts` | Guard — refuses remote DB URLs |
| `10-audit-trail.test.ts` | Functional — app manager audit trail |
| `11-work-order-write-rules.test.ts` | Contract — WO authorization and removed public `from-quotation` |
| `13-work-order-quotation-basis.test.ts` | Functional — quotation basis guards |
| `14-stress-work-order-quotation.test.ts` | Stress — quotation-backed WO (writes `work-order-quotation-stress-report.json`) |
| `15-work-order-history.test.ts` | Functional — WO history |
| `16-work-order-snapshot-minimisation.test.ts` | Regression — quotation snapshot shape |

Suites `11` and `13` deliberately assert that **`POST /api/v1/fieldservice/work-orders/from-quotation`** returns **404**: clients must use **`POST /api/v1/marketing/quotations/{quotationId}/work-order`**, which calls the internal gateway path documented in OpenAPI **2.8.3**.

## Running the suites

```bash
cd marketing-service

npm test              # every suite
npm run test:functional    # baseline behaviour
npm run test:concurrency   # concurrency suites
npm run test:stress        # load and stress suites (long running)
```

A single suite can be run directly:

```bash
node --test --import tsx --test-concurrency=1 --test-timeout=900000 \
  "tests/14-stress-work-order-quotation.test.ts"
```

## Reports

| File | Suite | Scope |
|---|---|---|
| `stress-report.json` | `03-stress-load.test.ts` | Marketing company list and create |
| `work-order-quotation-stress-report.json` | `14-stress-work-order-quotation.test.ts` | Field Service Work Order creation from a quotation |

Every report lists the scenarios that ran, with the concurrency, the request
rate and the latency percentiles of that run.

## Work Order quotation stress results

Recorded on a local PostgreSQL instance with 8 CPU cores, through the API
Gateway. The numbers below describe that machine only; they are a baseline for
regression, not a capacity claim.

| Scenario | Concurrency | Requests | Outcome | p50 | p95 |
|---|---|---|---|---|---|
| `contended-create` | 12 | 12 | 1 created, 11 refused with 409 | 847 ms | 896 ms |
| `parallel-create` | 12 | 24 | 24 created | 426 ms | 597 ms |
| `duplicate-quotation-create` | 10 | 20 | 1 created, 19 refused with 409 | 64 ms | 215 ms |
| `revoke` | 6 | 12 | 12 revoked | 154 ms | 598 ms |
| `read-list` | 20 | 120 | 120 listed | 177 ms | 228 ms |

Numbers above are taken from the latest `work-order-quotation-stress-report.json`
on disk. The file may still list a legacy `pending-event-create` block from an
older suite revision; re-run `14-stress-work-order-quotation.test.ts` to refresh
it completely.

### What the scenarios prove

- **One quotation backs at most one Work Order.** Contended and duplicate-load
  scenarios each produce exactly one `201` and the rest `409`. Marketing row
  locking plus Field Service branch locks enforce the invariant.
- **Distinct quotations do not block each other.** Twenty-four concurrent
  creations for twenty-four quotations all succeed.
- **Revoking keeps the mirror consistent.** After concurrent revokes, every
  quotation link in Marketing is cleared.
- **No server errors under load.** No scenario produced a `5xx` or a timeout in
  the recorded run.

### Observed limits

- The contended path is serialised by design, so its latency grows with the
  number of simultaneous requests for the same quotation. The measured
  latencies include Marketing orchestration (Field Service internal create +
  quotation attach), not raw database time alone.
- Quotation-backed creation is synchronous: Marketing attaches the Work Order
  link in the same request. If attach fails after Field Service created the row,
  Marketing compensates by revoking the Work Order rather than leaving an orphan.
- The preparation step (approving a quotation renders a PDF and stores it) is
  far slower than the Work Order path itself. It is throttled on purpose, so
  a saturated connection pool is reported as a preparation problem instead of
  hiding the measurement.
- A single run of the whole suite takes about five minutes on the machine
  above.
