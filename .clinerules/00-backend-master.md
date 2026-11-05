---
paths:
  - "backend/**"
  - "server/**"
  - "api/**"
  - "services/**"
  - "apps/api/**"
  - "apps/backend/**"
---

# Backend Engineering Rules

Apply these rules when working on backend code. Adapt path patterns above to the repository's actual layout.

## Backend architecture
- Follow the existing framework and architecture.
- Keep transport/controller, application/business, domain, and persistence responsibilities appropriately separated.
- Keep business rules out of controllers and request handlers where practical.
- Use explicit request/response DTOs or schemas where the project uses them.
- Validate input at the API boundary and enforce authorization at the server.
- Use consistent error handling and response conventions.
- Keep external integrations behind clear interfaces where useful.
- Make background jobs retry-safe and idempotent where required.

## API contract
- Treat API contracts as maintained interfaces.
- Keep routes, validation, DTOs, serializers, status codes, auth requirements, and OpenAPI/Swagger aligned.
- Consider backward compatibility and versioning for contract changes.
- Do not expose internal implementation details in API responses.

## Backend documentation
- Maintain backend `README.md`.
- Maintain OpenAPI/Swagger for relevant API endpoints.
- Update docs whenever API behavior, setup, environment, database, queue, architecture, or operations change.
- See `01-api-openapi-swagger.md`.

## Data correctness
- Use transactions and constraints for invariants that must be atomic.
- Consider idempotency, locking, retries, and duplicate delivery for concurrent workflows.
- Do not assume sequential execution.
- See `02-database-transactions.md`.

## Testing
- Add/update tests for business logic, API contracts, persistence, authorization, and failure paths.
- Evaluate race-condition, concurrency, load, and stress tests for critical paths.
- See `03-backend-testing.md`.

## Safe operations
- Never run destructive migrations, truncate production data, or execute production load tests without explicit authorization.
- Never log secrets or sensitive request bodies.
