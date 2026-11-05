# Unknowns and Unverified Information

> This file separates confirmed gaps from the decisions listed in `decisions.md`.
> Use UNKNOWN when the repository evidence reviewed so far does not establish a fact. No new repository scan was performed for this file.

## Runtime and deployment

- **Domain-service Node engines — UNKNOWN.** `api-gateway/package.json` alone declares `^22.15.0 || ^24.0.0 || >=26.0.0`; the five domain-service manifests have no `engines` field. The actual runtime chosen by deployment is not established.
- **Deployment platform — UNKNOWN for all services.** Gateway code includes Vercel-specific proxy handling and marketing has `@vercel/nft`, but this does not prove that production deploys there; platform, topology and regions remain unverified.
- **Frontend repository — UNKNOWN.** No client-facing frontend was found in this backend repository; its location is not established.
- **S3-compatible provider — UNKNOWN.** Marketing uses `S3Client` with `AWS_ENDPOINT_URL_S3` and `forcePathStyle: true`; endpoint convention alone does not prove MinIO, AWS, Cloudflare R2, or another provider.

## Background processing

- **Production execution model for user-sync and tax-delivery workers — UNKNOWN.** Producer modules have timer/worker state and provide a bounded in-request batch fallback (`processDueUserSyncs`, `processDueTaxDeliveries`) for cases where no timer worker is started. The production deployment's persistent process, timer startup and delivery guarantees were not confirmed.
- **Durable queue semantics — UNKNOWN beyond current implementation.** Delivery rows, retry schedule, advisory locks and receiver idempotency are confirmed. Whether an external queue/scheduler, worker process manager, or serverless invocation guarantees eventual retries in production is not established.

## Tooling and validation

- **Test infrastructure — CONFIRMED ABSENT in the inspected repository state.** No `*.test.*`/`*.spec.*` files or Jest/Vitest configs; no `test` script in any of the six service manifests; no test runner in `devDependencies`. Available validation scripts are `npm run typecheck` and `npm run build` per service. No tests can currently be run without adding infrastructure. Whether the team intends to adopt a test runner is an OPEN QUESTION in `decisions.md`.
- **Database migration/rollout policy — UNKNOWN.** Services expose `db:push`; production schema deployment sequencing and backup/rollback policy were not confirmed.
- **Swagger route total and exact coverage gap — UNKNOWN / conflicting prior counts.** Earlier reports state 123 and 129 route definitions; OpenAPI's 43 paths / 63 operations are verified. The counts use different measures and the route total has not been reconciled. See `api-endpoints.md` for the prior inventory and caveat; do not use the ratio as authoritative until a targeted recount.
- **Swagger generation process — UNKNOWN.**

## Architecture intent

- **Shared `akura_auth` database intent — UNKNOWN.** Current state: auth and app-manager use it; human rationale/desired future state is unknown. See OPEN QUESTION in `decisions.md`.
- **Unused app-manager `Tax` model intent — UNKNOWN.** It has no source references; whether it is temporary, reserved, or accidental is not known. See OPEN QUESTION in `decisions.md`.
- **Branch foreign-key omission intent — UNKNOWN.** Current state is confirmed (nullable UUID, index, no relation); whether deliberate for service ownership or an integrity gap is unknown. See OPEN QUESTION in `decisions.md`.
- **Swagger coverage target — UNKNOWN.** Current coverage is 43 paths vs. 129 route definitions; the acceptable target or documentation policy is not established. See OPEN QUESTION in `decisions.md`.
- **Service enablement in each environment — UNKNOWN.** Finance/Field Service routes are conditional on URL+secret config; actual environment-specific enablement is not established.

## Security operations

- **JWT key rotation/overlap policy — UNKNOWN.** RS256, JWKS, key ID and JWKS cache are confirmed; how old/new keys overlap during rotation is not established.
- **Refresh-token rotation/revocation policy — UNKNOWN.** Refresh token routes and storage exist; exact rotation/reuse-detection and revocation policy was not established in the architecture pass.
- **Production secret rotation cadence — UNKNOWN.** Per-service gateway secrets and event-sync secrets are confirmed; rotation schedule and operational process are not.
- **Network exposure / TLS termination / WAF — UNKNOWN.** Application-level gateway guards are confirmed; cloud network boundaries and edge controls are not.
- **Production CORS origin values — UNKNOWN.** `CORS_ORIGIN` is validated/used, but deployed values are not documented here.

## Data model details not yet mapped

- Detailed field/relationship map for every table and every `onDelete` policy — UNKNOWN / intentionally omitted; see individual `*/prisma/schema.prisma` only when a task requires it.
- Exact S3 bucket lifecycle, retention and encryption policy — UNKNOWN.
- Whether all branch-scoped tables have complete query-level branch predicates — not audited exhaustively; the documents describe verified enforcement patterns, not a formal security audit.
