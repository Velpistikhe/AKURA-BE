---
paths:
  - "backend/**"
  - "server/**"
  - "api/**"
  - "services/**"
  - "apps/api/**"
  - "apps/backend/**"
  - "**/*test*"
  - "**/*spec*"
---

# Backend Testing Rules

For backend changes, evaluate the following test categories according to risk:

- Unit: domain rules, services, validators, mappers, utilities.
- Integration: database, cache, queue, storage, external adapters.
- API/contract: status codes, schema, validation, auth, errors, compatibility.
- Authorization: role/permission matrix, tenant isolation, IDOR/BOLA negative cases.
- Regression: existing bug and impacted workflows.
- Reliability: timeout, retry, partial failure, dependency unavailable.
- Concurrency: parallel requests/jobs, duplicate processing, race conditions, deadlocks, lost updates.
- Load/stress/soak: critical or performance-sensitive endpoints and workers.

## Concurrency test expectations
Where shared state is involved, use controlled parallel execution and assert final invariants, not merely response codes. Test simultaneous writes, duplicate requests, idempotency, transaction rollback, and worker retries as applicable.

## Load test expectations
Define target workload, duration, ramp-up, test data, and pass/fail thresholds. Observe latency percentiles, throughput, error rate, CPU/memory, database saturation, and queue depth when available.

Never run destructive or high-volume tests against production without explicit authorization. Do not invent benchmark results. Record test commands, environment assumptions, outcomes, and limitations in `docs/testing/` when useful.
