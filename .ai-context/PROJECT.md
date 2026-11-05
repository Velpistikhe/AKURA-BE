# Project profile

Project: **Akura** — multi-service Node.js + Express backend (API Gateway + 5 domain services).

- Project purpose: HTTP backend for the Akura platform (Indonesian field-service/company-management domain): auth + user management, app/menu administration, marketing (companies, contracts, items, quotations), field service work orders, finance/taxes.
- Repository shape: **not a monolith** — 6 independent npm packages in one repo, no root `package.json`, no npm workspaces.
- Node.js version: `api-gateway/package.json` declares `engines.node = ^22.15.0 || ^24.0.0 || >=26.0.0`. The other 5 manifests declare **no** `engines` (UNKNOWN for them). No `.nvmrc`. Local toolchain observed: node `v22.17.1`, npm `10.9.2`.
- Express version: `^4.19.2` (api-gateway, auth-service); `^4.22.2` (app-manager, fieldservice, finance, marketing). **Express 4 everywhere** — async handlers need the `asyncHandler` wrapper.
- Package manager: **npm** — one `package-lock.json` per service; no pnpm/yarn lockfiles.
- Language mix: **TypeScript only**. Zero `.js` files under any `src/`. Compiled with `tsc` to `dist/`.
- Module system: **CommonJS at runtime** (no `"type": "module"` in any manifest; `dist/app.js` emits `"use strict"` + `require(...)`). Source uses ESM-style `.js` import specifiers, resolved by `moduleResolution: NodeNext`.
- TypeScript config: identical across all 6 `tsconfig.json` — `target ES2022`, `module/moduleResolution NodeNext`, `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `declaration`, `sourceMap`, `outDir ./dist`, `rootDir ./src`.
- Build/runtime strategy: `dev` = `tsx watch src/server.ts`; `build` = `prisma generate && rimraf dist && tsc` (gateway omits `prisma generate`); `start` = `node dist/server.js`; `typecheck` = `tsc --noEmit`.
- Main entry point: `<service>/src/server.ts` → `src/app.ts` (Express app) → `src/server.ts` (listen + graceful shutdown). Per-service, not root.
- Test framework: **NONE**. No `test` script, no `*.test.*`/`*.spec.*` files, no Jest/Vitest config, no test runner in any `devDependencies`. See `COMMANDS.md`.
- Lint/format: **NONE**. No ESLint/Prettier config, no `lint` script anywhere.
- CI: **NONE** — no `.github/`, no `Jenkinsfile`.
- Persistence: **Prisma 5.x + PostgreSQL**, one `prisma/schema.prisma` per domain service (api-gateway has none). See `ARCHITECTURE.md`.
- Deployment: `vercel.json` with `"framework": "express"` in api-gateway, auth-service, app-manager-service, marketing-service. field-service and finance have no `vercel.json`.

## Service matrix

| Service | Port (default) | Role |
|---|---|---|
| `api-gateway` | 5000 | Reverse proxy + JWT verification + OpenAPI docs |
| `auth-service` | 5001 | Auth, users, JWKS, user-sync producer |
| `app-manager-service` | 5002 | Menus, menu items, menu accesses, office branches |
| `marketing-service` | 5003 | Companies, staff, contracts, prices, items, quotations |
| `finance-service` | 5004 | Taxes + tax-delivery producer |
| `fieldservice-service` | 5005 | Work orders, options, user-sync consumer |

Ports from `api-gateway/.env.example` and `finance-service/src/config/env.ts`.

## Databases (per `.env.example`)

| Service | Default database |
|---|---|
| `auth-service` | `akura_auth` |
| `app-manager-service` | `akura_auth` (**shared** with auth-service) |
| `marketing-service` | `akura_marketing` |
| `finance-service` | `akura_finance` |
| `fieldservice-service` | `akura_fieldservice` |

Evidence: `<service>/.env.example` `DATABASE_URL`. Each service still has its own separate Prisma client and schema file.

## Evidence
- Manifests: `*/package.json`; configs: `*/tsconfig.json`; env: `api-gateway/.env.example`, `finance-service/src/config/env.ts`
- Entry: `api-gateway/src/{app,server}.ts`, `finance-service/src/{app,server}.ts`, `auth-service/src/app.ts`, `app-manager-service/src/server.ts`
- Schema: `*/prisma/schema.prisma`

## Key constraints
- Multi-service repo — change and validate **one service at a time**; there is no root-level build.
- Codebase is already fully TypeScript; there is no JS→TS migration to do.
- Prefer targeted symbol retrieval over full source-tree reading.
- Only `npm run typecheck` / `npm run build` validate changes (no tests, no lint).
