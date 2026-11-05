# Context and token budget

## Default context budget

1. Read `.ai-context/INDEX.md` only as the entry point.
2. Read at most the one or two memory pages directly relevant to the task.
3. Retrieve only the target symbol and the references needed to establish impact.
4. Retrieve tests only for the affected behavior.
5. Stop exploring once there is enough evidence to implement and validate safely.

## Retrieval order

1. Serena: `get_symbols_overview`, `find_symbol`, `find_referencing_symbols`.
2. Serena: `find_file` / `search_for_pattern` when symbol lookup is insufficient.
3. Exact `rg` search with a narrow path/glob and limited output.
4. Read a bounded section or the full file only if required to understand local control flow.

## Avoid

- `list_dir` or recursive file listing over the whole repository.
- Broad searches such as `TODO` or common identifiers across the whole project.
- Reading package lockfiles or generated bundles unless the task concerns them.
- Repeating onboarding, indexing, or architecture discovery on every task.
- Pasting large tool output into the answer. Summarize only findings relevant to the change.

## Cache validity

Reuse prior findings only if the relevant files have not changed in the current task and the task concerns the same behavior. If Git diff, timestamps, or direct inspection show a relevant change, retrieve the affected symbol again.

## Escalation

Broaden the search only when:

- a symbol cannot be resolved;
- references show cross-module impact;
- tests reveal another dependency;
- the behavior crosses an API, persistence, queue, or auth boundary;
- the initial hypothesis is disproved.

Never trade correctness or security for token savings.

## Multi-service retrieval strategy

Akura contains six independent npm packages:

- api-gateway
- auth-service
- app-manager-service
- fileservice-service
- finance-service
- marketing-service

Rules:

- There is no root package.json and no shared package.
- Identify the owning service before exploring implementation.
- Run npm commands only inside the relevant service directory.
- For cross-service behavior, inspect the gateway and only the directly involved services.
- Do not assume a shared database, shared utility, or shared runtime configuration.
- Read the relevant service package.json before selecting validation commands.

## Serena-free fallback

When Serena is unavailable:

1. Start from the named file or symbol.
2. Use narrow workspace search.
3. Inspect direct callers and references.
4. Inspect only relevant tests and configuration.
5. Stop when sufficient evidence exists.

## Multi-service command discipline

- Identify the affected service before executing commands.
- Never execute npm commands from repository root.
- Read the target service package.json before running unfamiliar commands.
- Use npm run typecheck as the default validation.
- Build only when justified by the change.
- Never invent test, lint, or format scripts.
- Never read package-lock.json unless dependency changes require it.

## Cross-service impact

- Inspect the gateway when a change affects routing, authentication, or forwarded headers.
- Inspect another domain service only when direct dependencies or API contracts require it.
- Do not inspect all six services by default.
- Validate each service actually affected by the change.

## No Serena assumption

- Serena MCP is optional.
- If unavailable, use built-in workspace search and file navigation.
- Never attempt automatic installation or repeatedly retry unavailable Serena tools.
