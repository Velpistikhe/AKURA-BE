# Testing, validation, and safety rules

## Package and command discipline

- Akura has six independent npm services.
- There is no root package.json and no shared root npm scripts.
- Run npm commands only inside the affected service directory.
- Never assume a command exists. Check that service's package.json first.
- Do not run npm test, npm lint, or formatting commands unless the relevant script and tooling are confirmed to exist.

## Validation

- Use `npm run typecheck` as the default validation command for an affected service.
- Run `npm run build` when the change affects compilation, generated output, or build behavior.
- Run validation separately inside each affected service.
- For multi-service changes, validate every affected service.
- Do not claim tests passed if no test suite was executed.
- If validation cannot run, report the exact reason and what remains unverified.

## Database safety

- Never run `npm run db:push` automatically.
- Treat db:push as a schema-mutating development command.
- Never run database mutation commands against production.
- Do not change Prisma schemas or database structures unless required by the task.
- Explain schema impact and request explicit approval before executing a database-mutating command.
- Run db:generate only when a Prisma schema change requires regenerated client code.

## Dependencies and configuration

- Do not install, remove, or upgrade dependencies without explicit approval.
- Do not modify package scripts, tsconfig, module settings, or environment configuration casually.
- Never overwrite environment files or expose secrets.
- Do not introduce new tools, runtimes, MCP servers, or local installations without approval.

## Before finishing

- Inspect git status and git diff.
- Review all changed files for unintended modifications.
- Check that changes remain within the requested scope.
- Report files changed, validation commands executed, results, and remaining risks.
