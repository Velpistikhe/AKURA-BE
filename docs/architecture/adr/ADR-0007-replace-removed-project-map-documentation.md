# ADR-0007: Replacing the Removed `.project-map` Documentation

**Status:** Accepted (reconstructed)
**Date:** Undated — reconstructed from source at commit `ec4484c`

---

## Context

Commit `ec4484c` removed two documentation trees from the repository:
`.project-map/` and `.ai-context/`.

**VERIFIED** — the deleted `.project-map/` contained at least:

| File | Purpose |
|---|---|
| `architecture.md` | Service map, trust model, database ownership |
| `unknowns.md` | Explicitly unverified items, separated from confirmed facts |
| `decisions.md` | Recorded decisions and open questions |
| `api-endpoints.md` | Endpoint inventory |

The `.ai-context/` tree held similar material for AI tooling.

The deletion left the repository with **no architectural documentation at all**.
That is a real loss: the architectural reasoning behind the platform was not
recoverable from the code alone, and a future contributor — human or AI —
would have had to re-derive it by reading 302 source files.

### The deleted documentation was also partly wrong

Two claims in the removed files were checked against the current code and
found to be false:

| Removed claim | Current reality |
|---|---|
| *"Auth and app-manager use `akura_auth`"* | Five separate databases. `akura_auth` and `akura_app_manager` are distinct. |
| *"Test infrastructure — CONFIRMED ABSENT... No `*.test.*`/`*.spec.*` files or Jest/Vitest configs; no `test` script in any of the six service manifests"* | `marketing-service/tests/` contains an 11-file reliability suite, and `marketing-service/package.json` has a `test` script. |
| Route counts quoted as "123" and later "129" | The OpenAPI document defines **102** path keys. |

**Assessment:** the documentation was not merely deleted for being wrong — but
it was also **not reliable when it existed**. A future reader who found
`.project-map/architecture.md` would have been confidently misled about the
database topology. Its own `unknowns.md` was admirably careful about what it
claimed, yet `architecture.md` asserted the shared database without hedging.

## Decision

**Create `docs/architecture/` as a replacement, and treat it as a derived
artifact that must be re-verified rather than trusted.**

Three properties distinguish it from the removed documentation:

### 1. Every claim carries a confidence label

| Label | Meaning |
|---|---|
| **VERIFIED** | Confirmed from source, with a `path:line` citation |
| **INFERRED** | A reasoned conclusion, with the reasoning stated |
| **UNKNOWN** | Not established; flagged for verification |

**Folder names are never treated as evidence.** Service purpose was established
by reading `package.json`, `src/server.ts`, `src/app.ts`, and the route
modules — not by trusting the directory name.

### 2. Conflicts are recorded, not silently resolved

When two sources disagree, both are recorded in a "Known conflicts and risks"
table with a severity and a remediation recommendation. Where a remediation
would require a schema change, it is **recommended but not applied** — the
documentation task does not authorise code or schema changes.

### 3. The documents record how they were verified

[`service-catalog.md`](../service-catalog.md) §5 lists every check performed
(service count, folder-to-package mapping, port agreement, database
separation, extra-service search) and its result.

### Location and naming

`docs/architecture/` rather than `.project-map/`. The `.`-prefixed name
signalled tool-consumption; `docs/` is the conventional location and is
discoverable by anyone browsing the repository.

## Consequences

**Positive**

- **The architecture is documented again**, with citations, in a form a new
  contributor can act on.
- **Stale claims cannot silently propagate.** A reader who spots a wrong
  claim can check the cited `path:line` in seconds.
- **The documentation becomes a checklist.** Changing routing, data
  ownership, or auth now has a documented blast radius.
- **The known issues are visible** rather than latent — including three
  orphaned Prisma models and the audit-trail fragmentation.

**Negative**

- **Derived documentation drifts.** It is a snapshot, and code moves faster
  than documents. The mitigation is the confidence labels and the citations,
  not a claim of permanence.
- **More files to maintain** — nine documents, eight diagrams, and eight ADRs.
- **The reconstruction caveat is permanent.** These ADRs were inferred from
  code, not from contemporaneous design records, and are labelled as such.

## Maintenance rule

**A change to routing, data ownership, authentication, or integration
boundaries is an architecture change and must update these documents before
the task is complete.** The order is: diagram → document → index → ADR (if a
decision was made, not merely implemented).

## Evidence

| Claim | Location |
|---|---|
| Removal of `.project-map/` and `.ai-context/` | `git show ec4484c` |
| Shared-database claim in the removed docs | `git show 'ec4484c^:.project-map/architecture.md'` |
| "Test infrastructure CONFIRMED ABSENT" claim | `git show 'ec4484c^:.project-map/unknowns.md'` |
| Five separate databases (current reality) | Each service's `DATABASE_URL` and `prisma/schema.prisma` |
| Test suite exists (current reality) | `marketing-service/tests/`, `marketing-service/package.json` |
| 102 documented path keys | `api-gateway/src/docs/*.ts` |

## Related

- [`../README.md`](../README.md) — §3 defines the confidence labels; §4 defines the maintenance workflow
