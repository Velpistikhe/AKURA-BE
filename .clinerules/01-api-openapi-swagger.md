---
paths:
  - "backend/**"
  - "server/**"
  - "api/**"
  - "services/**"
  - "apps/api/**"
  - "apps/backend/**"
---

# Backend API & OpenAPI/Swagger Rules

## Mandatory API documentation
Maintain an OpenAPI specification and a usable Swagger UI or equivalent documentation endpoint when supported by the stack. Reuse the project's existing solution. If none exists, select a framework-compatible, maintained approach and explain the dependency/setup change.

Document each API intended for consumers:
- HTTP method and path.
- Summary, description, and tags.
- Path, query, and header parameters.
- Request body and content types.
- Validation constraints and required/optional fields.
- Authentication and authorization requirements.
- Success response schemas and representative examples.
- Relevant error responses and status codes.
- Pagination, filtering, sorting, and idempotency behavior where applicable.

## Synchronization
When an endpoint is added, changed, deprecated, or removed:
1. Inspect the actual route registration and handler.
2. Inspect DTOs, validators, serializers, middleware, and authorization.
3. Update OpenAPI/Swagger in the project's established source format.
4. Ensure examples match actual schemas and behavior.
5. Run available schema validation or generation checks.
6. Update backend README with the documentation URL and generation/serve instructions if changed.

Do not hand-write a second specification if the project generates OpenAPI from source annotations/decorators or schemas. Update the authoritative source.

## Contract quality
- Use reusable schemas where appropriate.
- Define consistent error response formats.
- Document nullable, optional, enum, format, and constraint behavior accurately.
- Avoid exposing secrets or sensitive internal fields in examples.
- Do not invent endpoints or claim undocumented behavior is implemented.

## README requirements
Backend README should explain overview, prerequisites, setup, environment variables (names and safe examples only), run/build/test commands, migrations/seeds, API docs access, architecture overview, and deployment/operations notes as relevant.
