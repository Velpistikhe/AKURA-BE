# Testing documentation

This folder holds the recorded results of the load and stress runs of the
Akura reliability suite. The suites themselves live in
`marketing-service/tests/`.

## Safety

The suite only ever talks to the local PostgreSQL instance and the local test
ports (5100-5105). The environment guard in
`marketing-service/tests/support/env.ts` refuses to start when a database URL
points at a remote host, so a run can never touch a deployed environment.

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
| `contended-create` | 12 | 12 | 1 created, 11 refused with 409 | 1540 ms | 1681 ms |
| `parallel-create` | 12 | 24 | 24 created | 604 ms | 942 ms |
| `pending-event-create` | 10 | 20 | 20 refused with 409 | 218 ms | 312 ms |
| `revoke` | 6 | 12 | 12 revoked | 189 ms | 545 ms |
| `read-list` | 20 | 120 | 120 listed | 180 ms | 248 ms |

### What the scenarios prove

- **One quotation backs at most one Work Order.** Twelve concurrent
  creations for the same quotation produce exactly one Work Order and eleven
  `409` responses. The advisory lock and the duplicate check hold under
  contention.
- **Distinct quotations do not block each other.** Twenty four concurrent
  creations for twenty four quotations all succeed.
- **A pending synchronisation blocks the creation.** A quotation whose
  synchronisation event has not been delivered is refused with `409`, and no
  Work Order row is left behind.
- **Revoking keeps the mirror consistent.** After twelve concurrent revokes,
  every quotation link in Marketing is cleared.
- **No server errors under load.** No scenario produced a `5xx` or a timeout in
  the final run.

### Observed limits

- The contended path is serialised by design, so its latency grows with the
  number of simultaneous requests for the same quotation. The measured
  latencies include the Marketing validation call and the acknowledgement
  wait, so they are higher than the raw database time.
- The creation path makes one Marketing call per request and waits for the
  synchronisation acknowledgement. That wait is what makes the mirror
  consistent, and it is the main contributor to the write latency.
- The preparation step (approving a quotation renders a PDF and stores it) is
  far slower than the Work Order path itself. It is throttled on purpose, so
  a saturated connection pool is reported as a preparation problem instead of
  hiding the measurement.
- A single run of the whole suite takes about five minutes on the machine
  above.
