# Targeted debugging

## 1. Establish the failure

- Start from the exact error, stack trace, endpoint, or reported file.
- Read .ai-context/INDEX.md.
- Read at most one relevant context page.
- Identify the owning service.

## 2. Retrieve evidence

- Use Serena if available.
- Otherwise use targeted workspace search and file navigation.
- Inspect the failing symbol, direct callers, and immediate dependencies.
- Read only relevant middleware, validation, configuration, and data contracts.
- Do not scan unrelated services.

## 3. Reproduce and diagnose

- Discover the available command in the affected service package.json.
- Reproduce with the narrowest safe command.
- Capture relevant errors and stack frames only.
- Form a root-cause hypothesis and verify it against source.
- Distinguish confirmed causes from assumptions.

## 4. Fix

- Fix the root cause with the smallest cohesive change.
- Preserve existing API and data contracts.
- Ask before destructive, broad, or security-sensitive changes.
- Add a regression test only if an existing test framework and convention are available.
- Never introduce a test framework just for a routine fix without approval.

## 5. Validate

- Run npm run typecheck inside each affected service.
- Run npm run build only when justified.
- Do not invent test or lint commands.
- Do not claim tests passed when no tests ran.

## 6. Review and report

- Inspect git diff --stat and relevant diff.
- Check git status for unrelated changes.
- Report root cause, files changed, validation actually run,
  failures, and unresolved risks.

Expand scope only when evidence requires it.
Never repeat project onboarding during debugging.
