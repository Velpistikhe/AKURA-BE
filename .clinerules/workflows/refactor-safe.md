# Safe targeted refactor

## 1. Define scope

- Identify the exact service, symbol, module, and desired outcome.
- Read .ai-context/INDEX.md and only relevant context pages.
- Define behavior and compatibility that must remain unchanged.

## 2. Inspect dependencies

- Use Serena semantic navigation if available.
- Otherwise use targeted symbol search and exact references.
- Inspect the symbol definition, direct callers, imports, and exports.
- Inspect API, persistence, and cross-service contracts when affected.
- Do not inspect all six services by default.

## 3. Plan

- Identify the smallest safe sequence of changes.
- State a concise plan before multi-file or behavior-changing refactors.
- Ask before public API changes, destructive changes,
  or broad security-sensitive changes.

## 4. Refactor

- Change incrementally.
- Preserve existing runtime behavior unless explicitly requested.
- Reuse existing utilities and patterns.
- Avoid unrelated cleanup and duplicate implementations.
- Prefer semantic rename operations when available.
- If semantic tools are unavailable, use narrow edits.
- Review every changed reference after a rename or signature change.

## 5. Validate

- Run npm run typecheck inside every affected service.
- Run npm run build when justified.
- Use tests only when existing tests are actually available.
- Never invent test, lint, or format commands.

## 6. Review

- Inspect git diff --stat and relevant diff.
- Check imports, exports, callers, and public contracts.
- Check git status for unrelated or untracked changes.
- Report changed files, validation, failures, and risks.

Update .ai-context only when durable architecture,
module ownership, or conventions changed.
