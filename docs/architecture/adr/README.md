# Architecture Decision Records

Records of the significant architectural decisions in the Akura backend, and the
reasoning behind them.

## Why these exist

Most of the platform's structure is explained by a small number of decisions
that were made once and then applied consistently. These ADRs capture the
*why*, so that a future contributor can tell the difference between a
deliberate pattern and an accident.

**These are reconstructions.** They were written from the current source code,
not from contemporaneous design records — no ADR history existed in the
repository before this directory. Each ADR states the evidence it was derived
from, and where the reasoning had to be inferred, it says so. Treat the
"Context" and "Evidence" sections as the authoritative part; the "Decision"
and "Consequences" sections are the best available reconstruction.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](./ADR-0001-gateway-as-single-entrypoint.md) | Gateway as the single entry point | Accepted (reconstructed) |
| [0002](./ADR-0002-database-per-service.md) | Database per service | Accepted (reconstructed) |
| [0003](./ADR-0003-http-outbox-over-message-broker.md) | HTTP + transactional outbox instead of a message broker | Accepted (reconstructed) |
| [0004](./ADR-0004-rs256-jwt-with-remote-jwks.md) | RS256 JWTs with a remote JWKS | Accepted (reconstructed) |
| [0005](./ADR-0005-layered-service-credentials.md) | Layered service credentials | Accepted (reconstructed) |
| [0006](./ADR-0006-audit-trail-per-service.md) | Per-service audit trail, and its fragmentation cost | Accepted (reconstructed) — **contains an open issue** |
| [0007](./ADR-0007-replace-removed-project-map-documentation.md) | Replacing the removed `.project-map` documentation | Accepted (reconstructed) |
| [0008](./ADR-0008-hosted-development-environment.md) | Hosted development environment (Vercel + Neon branch) | Accepted (reconstructed) — **amended**: the four domain services approve the hosted targets by a fixed policy instead of `DEV_ALLOWED_REMOTE_HOSTS` |

## Format

```markdown
# ADR-NNNN: Title

**Status:** Accepted | Superseded by ADR-NNNN | Deprecated
**Date:** YYYY-MM-DD (or "Undated — reconstructed from source")

## Context
## Decision
## Consequences
## Evidence
```

**When the date is unknown, say so.** Do not invent one.

## Open issues

| ADR | Open issue |
|---|---|
| [0006](./ADR-0006-audit-trail-per-service.md) | The audit trail is fragmented across services; `GET /api/v1/app-manager/audit-trail` returns only App Manager's own rows, while Marketing writes a separate, incompatible trail. Options are analysed in the ADR; a decision is still needed. |

---

## Related

- [`../system-overview.md`](../system-overview.md) — the architecture these ADRs explain
- [`../README.md`](../README.md) — documentation index and confidence-label definitions
