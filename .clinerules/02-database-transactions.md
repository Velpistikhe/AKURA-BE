---
paths:
  - "backend/**"
  - "server/**"
  - "api/**"
  - "services/**"
  - "database/**"
  - "db/**"
  - "migrations/**"
  - "prisma/**"
---

# Backend Database, Transactions & Consistency Rules

## Schema and migrations
- Treat migrations as versioned source code.
- Preserve existing data unless data migration or deletion is explicitly required and authorized.
- Review migration direction, rollback strategy, locking, runtime, and compatibility.
- Add constraints and indexes to support real integrity and query needs.
- Update ERD and database architecture docs when schema or relationships change.
- Never edit production data directly as a shortcut.

## Transactions and invariants
Identify invariants that must remain true across concurrent requests. Use appropriate transactions, unique constraints, conditional/atomic updates, optimistic or pessimistic locking, or other proven mechanisms.

Evaluate:
- Isolation level and anomalies.
- Lost updates and stale reads.
- Double submission and duplicate processing.
- Deadlocks and lock ordering.
- Retry behavior and idempotency.
- Partial failures across database and external services.

Do not hold transactions open across slow network calls unless the architecture explicitly requires and safely handles it.

## Queues and distributed workflows
- Assume messages may be delivered more than once unless exactly-once behavior is genuinely guaranteed by the infrastructure.
- Make consumers idempotent where necessary.
- Define retry, backoff, dead-letter, and poison-message behavior.
- Use an outbox/inbox or equivalent pattern when reliable event publication/consumption is required.
- Document eventual consistency and compensation behavior.

## Audit consistency
For critical business operations, consider how the audit event is committed relative to the business transaction. Do not silently lose audit events when a transaction succeeds. Choose a transactional strategy appropriate to the system.

## Testing
Add tests for constraints, rollback, concurrent updates, duplicate requests, retries, and failure recovery as relevant. Use isolated test databases and synthetic data.
