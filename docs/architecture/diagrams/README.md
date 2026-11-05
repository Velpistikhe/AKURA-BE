# Architecture Diagrams

Mermaid source files for the Akura platform. Render with any Mermaid renderer
(GitHub, VS Code Mermaid extension, `mermaid-cli`, or a docs site).

## Legend

Every diagram follows the same confidence convention, matching the one used
across `docs/architecture/`.

| Style | Meaning |
|---|---|
| Solid line / solid box | **VERIFIED** — confirmed directly from source code or configuration. The diagram header cites the files. |
| Dashed line | **INFERRED** — a reasonable conclusion from verified evidence, but not directly stated in code. |
| Dotted line | **UNKNOWN / NEEDS VERIFICATION** — plausible but unproven. Requires confirmation outside the repository. |
| Green fill | Component verified to exist with the described role |
| Blue fill | Data store |
| Red fill, dashed border | Documented conflict / risk (see `docs/architecture/README.md`) |
| Purple fill | The API Gateway (the single edge) |

## Index

| # | File | Purpose |
|---|---|---|
| 1 | [`01-system-context.mmd`](./01-system-context.mmd) | System context: the platform, its actors, and its external dependencies. |
| 2 | [`02-container-service-architecture.mmd`](./02-container-service-architecture.mmd) | Container view: the six services, their internal modules, and their data stores. |
| 3 | [`03-service-dependency.mmd`](./03-service-dependency.mmd) | Who calls whom, split into synchronous lookups vs. asynchronous deliveries. |
| 4 | [`04-api-request-flow.mmd`](./04-api-request-flow.mmd) | Step-by-step request path through the gateway, including header handling. |
| 5 | [`05-authentication-flow.mmd`](./05-authentication-flow.mmd) | Login, token issuance, JWKS verification, and downstream re-validation. |
| 6 | [`06-database-data-ownership.mmd`](./06-database-data-ownership.mmd) | The five databases, table ownership, read models, and logical (non-FK) references. |
| 7 | [`07-event-flow.mmd`](./07-event-flow.mmd) | The three asynchronous delivery flows and their idempotent receivers. |
| 8 | [`08-deployment-topology.mmd`](./08-deployment-topology.mmd) | Verified local topology plus the production topology that still needs verification. |

## Reading notes

- **Every hop goes through the API Gateway.** No service holds another service's
  direct URL. This is the central invariant of the platform and is visible in
  diagrams 3 and 7 — outbound arrows terminate at the Gateway, not at a peer.
- **There is no message broker.** Asynchronous delivery is HTTP POST over the
  Gateway, backed by a transactional outbox in the producer's database. Diagram 7
  shows producers and receivers with the Gateway in between; that is the real
  topology, not a stylistic choice.
- **Dashed "logical reference" arrows in diagram 6 are not foreign keys.**
  `officeBranchId` is a bare `uuid` column in Marketing, Finance and Field
  Service. The reference to `app-manager-service.office_branches` is enforced in
  application code only.
- **Diagram 8 mixes certainty levels deliberately.** The local topology is
  verified from configuration; the production topology is not established by
  anything in this repository.

## Keeping diagrams accurate

Diagrams are derived artifacts. When source changes, update the `.mmd` file and
the corresponding markdown document together. `docs/architecture/README.md`
describes the review workflow for this.
