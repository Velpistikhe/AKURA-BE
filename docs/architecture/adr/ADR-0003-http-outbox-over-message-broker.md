# ADR-0003: HTTP + Transactional Outbox Instead of a Message Broker

**Status:** Accepted (reconstructed)
**Date:** Undated — reconstructed from source at commit `ec4484c`

---

## Context

Several services need to publish changes to other services. The canonical
microservices answer is a message broker — Kafka, RabbitMQ, or a managed
equivalent — which decouples producers from consumers and provides durable
delivery.

A broker is also a significant operational commitment: a new infrastructure
dependency to run, secure, monitor, and pay for. For a platform at this size
(two event flows), that cost may not be justified.

The hard requirement is that **a committed change must never be lost**. If a
service writes a record and then crashes before publishing an event, the
event must still be delivered.

## Decision

**Use no broker. Deliver events as HTTP POSTs through the API Gateway, backed
by a transactional outbox in the producer's own database.**

The two flows:

| Producer | Consumer | Endpoint | Secret |
|---|---|---|---|
| finance | marketing | `POST /api/v1/marketing/internal/taxes/events` | `x-tax-sync-secret` |
| fieldservice | marketing | `POST /api/v1/marketing/internal/quotations/{quotationId}/work-order` | `x-work-order-sync-secret` |

The user directory is deliberately **not** replicated. Auth is the source of
truth, and no service reads it over the network: the directory lookups have
been removed, so there is nothing left for an outbox to deliver.

### The mechanism

1. **The producer writes the business change and the outbox row in one
   transaction.** Either both commit or neither does — this is what makes the
   event lossless.
2. **A worker picks up due deliveries** and POSTs to the receiver through the
   gateway.
3. **`pg_try_advisory_xact_lock(hashtext(id))`** ensures exactly one instance
   delivers a given job when several replicas run concurrently.
4. **The receiver applies a version guard**, so a duplicate or stale event is
   a no-op. It acknowledges only after committing.
5. **On failure, the delivery is retried** with exponential backoff:
   `min(300000, 10000 * 2 ** min(attempt - 1, 5))` plus 0–999 ms of jitter.

### Two execution modes

- **Timer worker** — a `setTimeout` loop started from `src/server.ts`, for
  long-running deployments.
- **In-request fallback** — a bounded batch (5 jobs) executed during the
  request that produced the event, for serverless deployments where no
  persistent timer exists.

Both call the same delivery function, so the advisory lock makes concurrent
execution safe.

The Work Order link delivery uses the same outbox pattern as tax: Field Service
commits the Work Order and an outbox row together, then delivers the HTTP callback
asynchronously. Marketing's quotation mirror (`hasWorkOrder`, `workOrderSnapshot`)
is **eventually consistent** with Field Service. The receiver is idempotent, and
the producer does not fail the client's write when delivery is delayed.

## Consequences

**Positive**

- **No new infrastructure.** No broker to deploy, secure, monitor, or pay for.
- **The outbox is transactional.** The event cannot be lost — this is the
  property a naive "publish after commit" implementation gets wrong, and the
  outbox is the standard remedy.
- **Exactly-once delivery per job**, enforced by the advisory lock rather
  than by broker semantics.
- **At-least-once delivery is safe**, because receivers are idempotent.
- **The receiver contract is a normal HTTP API**, so it is documented in the
  OpenAPI spec and testable with ordinary tools.

**Negative**

- **Delivery requires the gateway to be reachable.** There is no separate
  path that bypasses it.
- **No dead-letter queue.** A permanently failing delivery retries every five
  minutes indefinitely. The `attempts` counter and `lastError` are observable
  via the delivery-monitoring endpoints, but there is no automatic quarantine.
- **No attempt limit.** The retry count grows without bound.
- **Throughput is bounded by HTTP**, not by a broker's partition count.
- **On serverless platforms, delivery latency depends on request traffic.** A
  change that no subsequent request touches may not be delivered until a cold
  start.
- **Fan-out is expressed as N separate rows**, not one topic with N
  consumers.

**Neutral**

- The producer's write can succeed while delivery fails — deliberately. The
  Finance code swallows the in-request delivery error to avoid prompting a
  duplicate submission:
  *"The tax and outbox are already committed. Do not turn a successful write
  into an HTTP error that could cause the client to submit the tax again."*
  (`finance-service/src/modules/taxes/tax-delivery.ts:55-59`)

## Evidence

| Claim | Location |
|---|---|
| Outbox delivery + advisory lock | `finance-service/src/modules/taxes/tax-delivery.ts:42-70` |
| Backoff formula | `finance-service/src/modules/taxes/tax-delivery.ts:10` |
| Timer worker + in-request fallback | `tax-delivery.ts:42-89` |
| Acknowledgement shape validation | `tax-delivery.ts:59-60` |
| Receiver version guard | `marketing-service/src/modules/taxes/tax-events.routes.ts:33-51` |
| Ack only after commit | `api-gateway/src/docs/tax.ts:56` |
| Work-order outbox delivery | `fieldservice-service/src/modules/work-orders/work-order-link-delivery.ts` |
| Work-order outbox enqueue | `fieldservice-service/src/modules/work-orders/work-order-link-outbox.ts` |
| No broker client dependency | All six `package.json` manifests |

## Related

- [ADR-0001](./ADR-0001-gateway-as-single-entrypoint.md) — why every event traverses the gateway
- [`../integration-and-event-flow.md`](../integration-and-event-flow.md) — the full flow reference
