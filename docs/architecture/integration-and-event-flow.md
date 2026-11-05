# Integration and Event Flow

> How services talk to each other: synchronous reference lookups, asynchronous
> outbox deliveries, and the retry/idempotency machinery behind them.
> Confidence labels are defined in [`README.md`](./README.md#3-confidence-labels).

---

## 1. Two integration patterns

**VERIFIED** — the platform uses exactly two patterns, and there is no third.

| | Synchronous reference lookup | Asynchronous delivery |
|---|---|---|
| Direction | Request → response, inline | Producer → receiver, decoupled |
| Failure mode | Fails the caller's request | Retried in the background |
| Consistency | Strong at the moment of the call | Eventual |
| Used for | Reading data owned by another service | Replicating data into a read model |

**The user directory is read, not replicated.** Auth owns the users table, and
the consumers pull the contacts and inspectors they need live. There is no
replica of it and therefore no user event flow.

**The user directory is read, not replicated.** Auth owns the users table, and
the consumers pull the contacts and inspectors they need live. There is no
replica of it and therefore no user event flow.
| Inventory | 12 distinct calls | 2 flows |

**Both patterns traverse the API Gateway.** There is no direct service-to-service
URL anywhere in the codebase.

---

## 2. Synchronous reference lookups

### 2.1 Inventory

**VERIFIED** — every outbound call site in the five domain services:

| # | Caller | Call | Purpose | File |
|---|---|---|---|---|
| 1 | marketing | `GET auth/me` | Live profile for authorization | `src/middlewares/authorize.middleware.ts:33` |
| 2 | marketing | `POST fieldservice/work-orders` | Create a Work Order from a quotation | `src/modules/quotations/quotation.controller.ts:151` |
| 3 | marketing | `DELETE fieldservice/work-orders/:id` | Compensating revoke | `src/modules/quotations/work-order.integration.ts` |
| 4 | marketing | `GET fieldservice/work-orders/by-quotation/:id` | Check for an existing live Work Order | `src/modules/quotations/quotation.controller.ts:89` |
| 5 | finance | `GET auth/me` | Live profile for authorization | `src/middlewares/actor.middleware.ts:10` |
| 6 | fieldservice | `GET auth/me` | Live profile for authorization | `src/middlewares/actor.middleware.ts:10` |
| 7 | fieldservice | `GET auth/users/field-service/inspectors` | Validate inspectors | `src/integrations/auth-directory.ts` |
| 8 | fieldservice | `GET marketing/quotation-references/:id` | Quotation basis | `src/integrations/gateway.ts:144` |
| 9 | fieldservice | `GET marketing/contract-references/:id` | Contract basis | `src/integrations/gateway.ts:310` |
| 10 | fieldservice | `GET marketing/item-size-references/:id` | Item size identity | `src/integrations/gateway.ts:253` |
| 11 | fieldservice | `GET marketing/quotation-references` | Quotation options list | `src/integrations/gateway.ts:273` |
| 12 | marketing | `GET auth/users/marketing-contacts` | Quotation contact directory | `src/modules/quotations/quotation.controller.ts` |
| 13 | fieldservice | `GET auth/users/field-service/inspector-directory` | Inspector options | `src/integrations/auth-directory.ts` |
| 12 | marketing | `GET auth/users/marketing-contacts` | Quotation contact directory | `src/modules/quotations/quotation.controller.ts` |
| 13 | fieldservice | `GET auth/users/field-service/inspector-directory` | Inspector options | `src/integrations/auth-directory.ts` |
| — | all services | `GET auth/.well-known/jwks.json` | Key material | `*/src/utils/tokens.ts:11` |

### 2.2 The standard call shape

**VERIFIED** — `fieldservice-service/src/integrations/gateway.ts:146-163` is the
clearest example:

```ts
response = await fetch(serviceUrl(path), {
  headers: {
    Authorization: `Bearer ${token}`,      // forward the user's token
    ...serviceHeaders(path),               // x-service-name + x-service-secret
    'x-request-id': String(req.headers['x-request-id'] ?? ''),
  },
  signal: AbortSignal.timeout(5000),        // bounded, never unbounded
});
```

Conventions present in every call:

| Convention | Purpose |
|---|---|
| `serviceUrl(path)` | Guarantees the call goes through the gateway; validates the path |
| `serviceHeaders(path)` | Authenticates the calling service to the gateway |
| `Authorization: Bearer <token>` | Lets the gateway authorize the *user* on the target's behalf |
| `x-request-id` propagated | Preserves the correlation chain across services |
| `AbortSignal.timeout(...)` | Bounds the call: 5 s for reads, 10 s for writes, 30 s for S3 |
| `redirect: 'error'` on writes | Prevents a redirect from leaking the request elsewhere |

### 2.3 Error mapping — fail closed

**VERIFIED** — upstream statuses are mapped deliberately rather than passed
through blindly.

| Upstream status | Mapped to | Reason |
|---|---|---|
| 400, 401, 403, 404, 409 | **Passed through** | A business rejection is the caller's problem too |
| Any other 4xx/5xx | **502** | The upstream returned something unusable |
| Timeout / network error | **503** | The upstream is unavailable |
| Malformed JSON body | **502** | The upstream violated its contract |

**VERIFIED** — `fieldservice-service/src/integrations/gateway.ts:158-164`:

```ts
if (response.status === 404) throw new HttpError(mismatch, 409);
if (response.status === 401 || response.status === 403) throw new HttpError('Unable to validate the quotation with Marketing service', response.status);
if (!response.ok) throw new HttpError('Marketing service is currently unavailable; retry later', 503);
```

**The 404 → 409 remap is deliberate.** A 404 from Marketing means the quotation
is no longer exposed (inactive, revised, or removed), which is a *conflict with
the stored snapshot*, not a missing resource:

> *"404 means Marketing no longer exposes the quotation (inactive, revised or
> removed): the stored snapshot has drifted from the source of truth."*
> — `fieldservice-service/src/integrations/gateway.ts:156-158`

### 2.4 Response validation

**VERIFIED** — upstream responses are parsed with `zod` before use. A response
that does not match the expected shape becomes a **502**, never a silent
misinterpretation:

```ts
const parsed = quotationSchema.safeParse(await gatewayGet(...));
if (!parsed.success) throw new HttpError('Invalid quotation response', 502);
```

The schemas use `.passthrough()` so unknown upstream fields are tolerated —
but the *required* fields are enforced.

### 2.5 Data minimisation on the way in

**VERIFIED** — upstream payloads are projected through **explicit allowlists**
before being stored in a JSON snapshot:

> *"Price fields are validated here so an incomplete upstream payload still
> fails as 502, but they are deliberately dropped by toQuotationSnapshot and
> never persisted."*
> — `fieldservice-service/src/integrations/gateway.ts:40-42`

This prevents an upstream field addition from silently leaking into a
persisted snapshot. The OpenAPI spec confirms the intent for the Work Order
options endpoint: *"every price field of the quotation is excluded by an
explicit allowlist projection"*
(`api-gateway/src/docs/work-orders.ts:241`).

### 2.6 Compensation for partial failure

**VERIFIED** — the one place where a two-service operation spans a transaction
boundary, Marketing compensates:

```ts
try {
  await quotationRepository.attachWorkOrder(quote.id, branch, workOrder, getAuditActor(res));
} catch (error) {
  // Marketing could not store the link, so the Work Order must not stay
  // live: revoke it in Field Service before reporting the failure.
  await notifyFieldServiceWorkOrderRevoked(workOrder.id, workOrder.version, req).catch(() => undefined);
  throw error;
}
```
— `marketing-service/src/modules/quotations/quotation.controller.ts:178-183`

---

## 3. Asynchronous delivery — the transactional outbox

### 3.1 The pattern

**VERIFIED** — the platform has **no message broker**. Asynchronous delivery
is HTTP POST through the gateway, with a transactional outbox in the producer's
own database.

```
Producer transaction:
  BEGIN
    write the business change          ──┐
    write the outbox event row          ──┤  same transaction
  COMMIT
                                       │
  Later (timer or in-request fallback): │
    SELECT ... WHERE deliveredAt IS NULL AND nextRetryAt <= now()
    pg_try_advisory_xact_lock(hashtext(id))   ← exactly one instance wins
    POST to the receiver via the gateway
    on success  → deliveredAt = now()
    on failure  → attempts++, nextRetryAt = now + backoff, lastError = msg
```

### 3.2 The one flow

| # | Producer | Consumer | Endpoint | Secret header | Outbox tables |
|---|---|---|---|---|---|
| 1 | finance | marketing | `POST /api/v1/marketing/internal/taxes/events` | `x-tax-sync-secret` | `tax_events`, `tax_deliveries` |

**The second event endpoint** — `POST /api/v1/marketing/internal/work-orders/events`
— is **not** an outbox delivery. It is a synchronous callback made from inside
the Field Service transaction. See §4.

**The user event endpoints are gone.** Auth used to push user snapshots to
Marketing and Field Service; the directory is now read live, so there is no
user outbox, no `user_sync_events` table and no `x-user-sync-secret` header.

### 3.3 Retry and backoff

**VERIFIED** — `finance-service/src/modules/taxes/tax-delivery.ts:10`:

```ts
export const retryDelay = (attempt: number) =>
  Math.min(300000, 10000 * 2 ** Math.min(attempt - 1, 5));
```

| Attempt | Base delay | With jitter (0–999 ms) |
|---|---|---|
| 1 | 10 s | 10.0–11.0 s |
| 2 | 20 s | 20.0–21.0 s |
| 3 | 40 s | 40.0–41.0 s |
| 4 | 80 s | 80.0–81.0 s |
| 5 | 160 s | 160.0–161.0 s |
| 6 | 300 s (capped) | 300.0–301.0 s |
| 7+ | 300 s (capped) | 300.0–301.0 s |

**Maximum delay is 5 minutes.** The jitter prevents a thundering herd when
many deliveries come due at once.

**There is no maximum attempt count and no dead-letter state.** A delivery that
can never succeed retries every 5 minutes indefinitely. The `attempts` counter
and `lastError` are observable through `GET /api/v1/finance/taxes/deliveries`.

### 3.4 Single-delivery guarantee

**VERIFIED** — `tax-delivery.ts:15-16`:

```ts
const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
  SELECT pg_try_advisory_xact_lock(hashtext(${id})) AS acquired`;
if (!lock.acquired) return;
```

The lock is held for the duration of the delivery transaction
(`timeout: 20000, maxWait: 5000`). If another instance is already delivering
this job, the second instance returns immediately without sending.

**This is what makes multiple replicas safe.** It is also why the lock must be
transaction-scoped (`_xact_lock`): if the process dies mid-delivery, the lock
is released automatically.

### 3.5 Acknowledgement contract

**VERIFIED** — the producer requires a specific acknowledgement shape
(`tax-delivery.ts:30-31`):

```ts
const ack = await response.json() as { eventId?: string; success?: boolean };
if (ack.eventId !== job.eventId || ack.success !== true) throw new Error('Invalid delivery acknowledgment');
```

A 200 with a wrong body is treated as a **failure**, and the job is retried.

The receivers acknowledge only **after** their transaction commits
(`api-gateway/src/docs/tax.ts:56`: *"Acknowledgment is sent only after
commit"*). This means a duplicate delivery after a timeout is safe — the
receiver's version guard makes it a no-op.

### 3.6 Worker execution model

**VERIFIED** — two mechanisms run deliveries:

**A. Timer worker** (`startTaxDelivery`), started from `src/server.ts`. It
loops: fetch up to 20 due jobs, deliver them one at a time, then schedule the
next run at the earliest `nextRetryAt` (`tax-delivery.ts:94-110`). On an internal
error it schedules a retry in 10 seconds.

**B. In-request fallback** (`processDueTaxDeliveries`), called during a request
that produced an event. It delivers a bounded batch (5 jobs) so committed events
are pushed even when no timer worker is running — the serverless / "app
imported without server.ts" case (`tax-delivery.ts:72-73`).

**Both mechanisms use the same `deliverTax` function**, so the advisory lock
makes concurrent execution safe.

**`startTaxDelivery()` calls `wakeTaxDelivery()` on startup** with the comment
*"Recover committed outbox entries after restart"* — so a restart resumes
outstanding deliveries.

### 3.7 A deliberate non-failure

**VERIFIED** — `tax-delivery.ts:55-59`:

```ts
} catch {
  // The tax and outbox are already committed. Do not turn a successful write
  // into an HTTP error that could cause the client to submit the tax again.
  logger.error('Tax delivery batch unavailable; pending entries remain queued');
}
```

If the in-request delivery batch fails, the error is **swallowed**. The tax
write already committed; reporting an error would prompt the client to submit
again and create a duplicate. The delivery will be retried by the worker.

This is a deliberate consistency trade-off: **the tax write succeeds even if
delivery fails**. The read model converges later.

---

## 4. Event receivers — idempotency

### 4.1 The receiver contract

**VERIFIED** — every receiver:

1. Is mounted **before** the `authenticate` middleware, because it authenticates
   with its own sync secret rather than a user token
   (`marketing-service/src/app.ts:23-25`, `fieldservice-service/src/app.ts:23`).
2. Compares the shared secret with `timingSafeEqual` after a length check.
3. Validates the payload with `zod`.
4. Applies a **version guard** so a duplicate or stale event is a no-op.
5. Writes its own audit entry, attributed to the sending service.
6. Acknowledges **after** committing.

### 4.2 The version guard

**VERIFIED** — `marketing-service/src/modules/taxes/tax-events.routes.ts:33-51`:

```ts
const current = await tx.taxCacheRevision.findUnique({ where: { officeBranchId: event.officeBranchId } });
if (current && current.version >= event.version) {
  // duplicate or older → acknowledge without changing the cache
}
await tx.taxCache.deleteMany({ where: { officeBranchId: event.officeBranchId } });
if (event.taxes.length) await tx.taxCache.createMany({ data: ... });
await tx.taxCacheRevision.upsert({ where: { officeBranchId: event.officeBranchId }, ... });
```

**Consequence:** at-least-once delivery is safe. The receiver converges to the
producer's state regardless of how many times an event arrives.

### 4.3 The work-order callback is synchronous, not queued

**VERIFIED** — `fieldservice-service/src/integrations/gateway.ts:176-203`.

The Work Order link-state callback posts to
`marketing/internal/work-orders/events` with `x-work-order-sync-secret`, but
it is invoked **inside the Field Service write path**, not from an outbox:

> *"For revokes the callback also clears the quotation reference; it is
> synchronous so any failure aborts the Field Service transaction and the two
> services remain consistent."*
> — `fieldservice-service/src/integrations/gateway.ts:176-180`

**Consequence:** if Marketing is unavailable, the Work Order status change is
**not committed**. The two services stay consistent by refusing to advance
one without the other — at the cost of Field Service writes failing while
Marketing is down.

The receiver is still idempotent (duplicate events are ignored), so a retry
after a network timeout is safe.

### 4.4 Receiver-side secret handling

**VERIFIED** — the receivers compare secrets with:

```ts
const supplied = req.headers['x-tax-sync-secret'];
if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) { /* 403 */ }
```

The length pre-check is required because `timingSafeEqual` throws on a length
mismatch — an important detail, since an unguarded call would produce a 500
instead of a clean 403.

---

## 5. Choosing between the two patterns

**VERIFIED** — the codebase applies a consistent rule:

| Use | Pattern | Why |
|---|---|---|
| The caller needs the data **now** to decide something | Synchronous | The decision depends on it |
| The data is a **replica** of another service's truth | Asynchronous | Staleness is acceptable; the replica converges |
| The write must **not** proceed if the other service is down | Synchronous | Consistency over availability |
| The write is already committed and the notification is best-effort | Asynchronous | Availability over immediacy |

**Worked example — the tax write.** Creating a tax rate must not fail because
the Marketing read model is temporarily unreachable. The tax is written and the
outbox event is recorded in one transaction; delivery happens afterwards. If
delivery fails, the retry loop handles it, and Marketing's cache converges
(`tax-delivery.ts:55-59`).

**Worked example — a Work Order status change.** Here the opposite applies. If
Marketing cannot record the new link state, the Work Order change is rolled
back, because a Work Order that exists without Marketing knowing about it
would be an inconsistent pair of records.

---

## 6. Integration risks

| Risk | Severity | Detail | Mitigation |
|---|---|---|---|
| **No broker → delivery requires a reachable gateway** | Medium | If the gateway is down, outbox deliveries cannot be sent | Outbox persists across restarts; backoff + jitter; the in-request fallback covers the serverless case |
| **No dead-letter queue** | Medium | A permanently failing delivery retries every 5 minutes forever, silently | `attempts` and `lastError` are exposed via the delivery-monitoring endpoints |
| **Work Order changes fail when Marketing is down** | Medium | Field Service writes are coupled to Marketing availability | Deliberate: consistency over availability. The compensation path also depends on Marketing |
| **No cross-service tracing** | Low | `x-request-id` propagates through the gateway and is forwarded on outbound calls, but there is no distributed tracing | Correlation IDs are present in every log line; enough to follow a request manually |
| **Delivery target URLs are validated, but not the secret** | Low | Finance validates that the tax delivery target is the gateway URL (`tax-delivery.ts:22`) | The gateway still has to route the request |



