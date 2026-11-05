# Project operating rules

Project: existing Node.js + Express monolith; mixed JavaScript and TypeScript; npm.

## Mandatory approach

- Minimize context while preserving correctness.
- Start from the task's named path/symbol and `.ai-context/INDEX.md`; do not enumerate or read the whole repository for ordinary tasks.
- Treat `.ai-context/` as navigation hints, not unquestionable truth. Verify relevant facts against current source.
- Prefer Serena semantic tools for symbol navigation when available. Use exact text search only when semantic navigation is insufficient.
- Expand scope incrementally: target symbol → direct references/callers → directly related tests/configuration.
- Do not repeat a search or reread unchanged content if its result is already present and still valid in this task.
- Never assume files, scripts, frameworks, database libraries, or test runners that have not been found in the repository.

## Before editing

- Identify the smallest affected area.
- Inspect current implementation and relevant callers before changing contracts.
- State a concise plan for multi-file or behavior-changing tasks.
- Preserve existing patterns and backward compatibility unless the task explicitly requests otherwise.
- Ask before destructive, broad, security-sensitive, or externally visible changes.

## After editing

- Inspect `git diff --stat` and relevant diff.
- Run the narrowest available validation. Discover commands from `package.json`; do not invent scripts.
- Report changed files, validation actually run, failures, and remaining risks.
- Update `.ai-context/` only when durable architecture, conventions, or module ownership changed.

## Hard boundaries

- Do not perform full-project scans for normal feature, bug, or refactor tasks.
- Do not read `node_modules`, generated output, coverage, build artifacts, logs, secrets, or data dumps.
- Do not create a second implementation when an existing utility/service already solves the problem.
- Do not add dependencies without explaining why and asking when the dependency is not clearly necessary.

## Tool availability and fallback

- Serena is optional. Never assume its MCP server is installed, running, or connected.
- If Serena tools are unavailable, continue using Cline's built-in workspace tools.
- Use targeted file search and symbol search instead of recursive repository scans.
- Never attempt to install Serena, Python, uv, or other runtimes automatically.
- Never repeatedly retry unavailable MCP tools.
- Do not block implementation merely because Serena is unavailable.
- Verify important symbols, callers, and contracts directly in source files.
