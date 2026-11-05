# Refresh selected project memory

Purpose: update only project memory that is demonstrably stale.

## When to use

Run this workflow only when:

- A material architecture or service-boundary change occurred.
- A documented command or convention changed.
- A memory page contradicts verified source evidence.
- The user explicitly requests a memory refresh.

Do not run after ordinary feature fixes or refactors
that do not change durable project knowledge.

## Procedure

1. Identify the changed area from the task description,
   Git diff, or verified source evidence.
2. Identify the owning service.
3. Inspect only changed files and directly affected symbols.
4. Read only the memory page describing that area.
5. Compare documented claims with current source and configuration.
6. Update only incorrect or stale sections.
7. Add evidence paths for important updated claims.
8. Keep INDEX.md compact and update it only when navigation changes.
9. Do not rerun onboarding or full-project indexing.
10. Do not require Serena for memory maintenance.

## Safety

- Never replace verified information with assumptions.
- Mark unresolved facts as "Unknown — verify in repository".
- Preserve unrelated documentation and user edits.
- Do not duplicate source code into memory.

## Completion

Report:

- Memory pages changed.
- Sections updated and why.
- Evidence paths inspected.
- Remaining unknowns.

If no durable information changed, do not edit memory.
