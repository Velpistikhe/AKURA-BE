# Review current diff

## 1. Establish review scope

- Run git status --short.
- Run git diff --stat.
- Review only changed files and relevant surrounding code.
- Do not scan the entire repository.

## 2. Review correctness

Check for:

- Incorrect control flow or business logic.
- Regressions and broken edge cases.
- Missing input validation.
- Authentication and authorization weaknesses.
- Unsafe database or Prisma changes.
- API and cross-service contract incompatibilities.
- Incorrect imports, exports, or dependency usage.
- Accidental secrets, generated files, or unrelated changes.

## 3. Trace impact

- Use Serena for changed public symbols when available.
- Otherwise inspect direct callers with targeted search.
- Expand into another service only when a changed contract requires it.
- Do not assume tests exist.

## 4. Validate evidence

- Inspect available validation commands in the affected service.
- Typecheck only if appropriate and not already verified.
- Do not run unavailable test or lint scripts.
- Do not modify code automatically during review.

## 5. Report findings

Order findings by severity:

1. Critical
2. High
3. Medium
4. Low

For each finding include:

- File and line reference.
- Concrete problem.
- Impact or reproduction condition.
- Recommended correction.

If no findings exist, state:

- Files and scope reviewed.
- Important contracts checked.
- Validation actually performed.
- Checks not performed and remaining limitations.

Do not claim the entire project is safe based on a partial diff review.
