# Persistent project memory policy

Memory root: .ai-context/

## Retrieval

- Read INDEX.md first.
- Read only topic pages relevant to the current task.
- Read at most 1-2 memory pages by default.
- Read additional pages only when direct dependencies require them.
- TASK-STATE.md is optional and short.
- Do not reread TASK-STATE.md unless continuing an interrupted task.

## Authority

- Current source code and package manifests are authoritative.
- Configuration and actual command output are evidence.
- Memory pages are concise summaries and navigation hints.
- Never treat memory as unquestionable truth.
- Mark unresolved facts as "Unknown — verify in repository".

## What to remember

Persist only durable discoveries:

- Architecture and service boundaries.
- Module ownership.
- Important request and data flows.
- Stable project conventions.
- Verified commands and tooling.
- Significant technical decisions.

## What not to remember

Do not persist:

- Temporary task notes.
- Speculative hypotheses.
- Routine bug fixes.
- Unverified behavior.
- Large source excerpts.
- Information already documented accurately.
- Secrets, credentials, tokens, or private data.

## Editing memory

1. Inspect the existing page before changing it.
2. Update only the relevant section.
3. Include evidence paths for important claims.
4. Avoid duplicating information across memory pages.
5. Update INDEX.md only when navigation or page relevance changes.
6. Preserve unrelated user changes.

## Serena independence

- Serena may improve symbol navigation but is optional.
- Memory reading and maintenance must work without Serena.
- Never trigger onboarding or indexing merely because Serena is unavailable.

## Completion

When memory changes, report exact pages and sections changed.
If no durable discovery occurred, leave memory unchanged.
