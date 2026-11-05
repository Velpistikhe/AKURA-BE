---
paths:
  - "src/**/*.js"
  - "src/**/*.cjs"
  - "src/**/*.mjs"
  - "src/**/*.ts"
  - "src/**/*.cts"
  - "src/**/*.mts"
  - "src/**/*.jsx"
  - "src/**/*.tsx"
  - "routes/**"
  - "controllers/**"
  - "services/**"
  - "middlewares/**"
  - "middleware/**"
  - "models/**"
  - "repositories/**"
  - "app.js"
  - "server.js"
  - "index.js"
  - "app.ts"
  - "server.ts"
  - "index.ts"
---

# Node.js / Express conventions

- Akura terdiri dari beberapa npm service independen. Selalu identifikasi service pemilik kode sebelum melakukan perubahan.
- Akura menggunakan Express 4. Tetap periksa package.json service terkait jika versi atau dependensinya mungkin berubah.
- Follow the repository's actual folder layout and established layering. Do not force MVC, repository, or clean architecture if it is not already used.
- Keep Express route registration, request validation, business logic, and persistence responsibilities consistent with nearby code.
- Preserve middleware order; order can affect authentication, parsing, CORS, rate limiting, and error handling.
- For async route handlers, preserve the existing Express 4 error propagation pattern. Do not introduce Express 5-specific assumptions or change error handling globally.
- Validate and normalize untrusted request input at the established boundary.
- Do not expose stack traces, secrets, internal SQL, or sensitive details in HTTP responses.
- Preserve status codes, response envelope, pagination, and API compatibility.
- Avoid changing route paths, parameter names, or response shapes without explicit task intent.
- Do not assume every service uses the same persistence layer. Verify the target service's actual implementation and dependencies before changing database access.
