# Implement feature with targeted context

Input: feature request and optional target service, path, or symbol.

## 1. Establish scope

1. Read .ai-context/INDEX.md.
2. Identify the owning service before exploring source.
3. Read at most 1-2 relevant context pages.
4. If the target service is unclear, consult MODULE-MAP.md.
5. Never assume a root package.json or shared package exists.

## 2. Retrieve evidence

Preferred retrieval:

1. Serena semantic tools, if available.
2. Built-in workspace symbol and file search.
3. Narrow exact text search with a limited path/glob.
4. Read bounded source sections as needed.

Inspect only:

- Target route, controller, service, model, or equivalent.
- Direct callers and references.
- Relevant middleware, validation, and contracts.
- Tests only if relevant tests actually exist.

Do not retry unavailable Serena tools.
Do not perform recursive full-project scans.

## 3. Understand impact

Before editing:

1. Identify the smallest affected area.
2. Check direct dependencies and backward compatibility.
3. Inspect the API gateway when routing, authentication,
   or forwarded headers are affected.
4. Inspect another service only when a direct contract or
   dependency requires it.
5. State a concise plan for multi-file or behavior-changing tasks.

Ask before destructive, broad, security-sensitive,
or externally visible changes.

## 4. Implement

- Make the smallest cohesive change.
- Preserve existing patterns and contracts.
- Reuse existing utilities and services.
- Do not add dependencies without justification and approval.
- Do not create duplicate implementations.
- Do not modify unrelated files.

## 5. Validate

There is no automated test suite, lint script, or formatter.

Default validation:

- Run npm run typecheck inside each affected service.

Additional validation:

- Run npm run build when justified by the change.
- Inspect the relevant package.json before selecting commands.
- Run Prisma generation only when required.
- Never run db:push automatically.
- Never invent npm scripts.
- Never claim tests passed when no tests were run.

## 6. Review

1. Inspect git diff --stat.
2. Inspect the relevant final diff.
3. Check git status for unrelated or untracked changes.
4. Verify no secrets, generated files, or unrelated edits were included.
5. Recheck affected contracts and compatibility.

## 7. Report

Summarize:

- Behavior implemented.
- Files changed.
- Services affected.
- Validation commands actually executed.
- Failures and unresolved risks.

Update .ai-context only when durable architecture,
conventions, or module ownership changed.

Never repeat project onboarding as part of feature implementation.
