# Onboard project once

Purpose: create compact, evidence-based project memory.
This is an explicit onboarding workflow, never a per-task routine.

## Existing project baseline

Akura has already been onboarded.

Verified facts:

- Six independent npm packages.
- No root package.json and no shared package.
- Services: api-gateway, auth-service, app-manager-service,
  fileservice-service, finance-service, marketing-service.
- Express 4, TypeScript, CommonJS runtime.
- Prisma and PostgreSQL in domain services.
- npm is the package manager.
- npm run typecheck is the only available validation command.
- No automated test runner, test script, lint script, or formatter.
- Serena is optional and may be unavailable.

Do not rediscover or overwrite these facts without new source evidence.

## When explicitly requested

1. Inspect root metadata and service manifests selectively.
2. Inspect only relevant tsconfig and configuration files.
3. Identify actual service boundaries and entry points.
4. Trace representative request flows only.
5. Verify commands from each service package.json.
6. Use Serena if available; otherwise use targeted workspace search.
7. Record evidence paths and distinguish verified facts from assumptions.
8. Update only affected .ai-context pages.
9. Keep documentation concise and avoid duplicated architecture descriptions.
10. Do not dump full directory trees or index source text.

## Completion

Report:

- Files inspected.
- Facts verified.
- Documentation changed.
- Remaining unknowns.

Do not repeat onboarding unless explicitly requested or
a material architectural change makes existing memory unreliable.
