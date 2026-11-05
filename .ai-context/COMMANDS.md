# Verified project commands

> Every command below exists verbatim in a `package.json`. There is **no root `package.json`** — run these **inside the service directory**.

## Per-service scripts (identical shape in all 6 services)

| Purpose | Command | Notes |
|---|---|---|
| Install | `npm ci` | Per service; `package-lock.json` present in each |
| Dev (watch) | `npm run dev` | `tsx watch src/server.ts` |
| Build | `npm run build` | `prisma generate && rimraf dist && tsc` (api-gateway: `rimraf dist && tsc`) |
| Start (prod) | `npm start` | `node dist/server.js` — requires a prior `build` |
| Typecheck | `npm run typecheck` | `tsc --noEmit` — **the only validation command available** |
| Prisma generate | `npm run db:generate` | `prisma generate` (5 domain services only) |
| Prisma push | `npm run db:push` | `prisma db push` — dev only, no migration tooling |
| Test | **None** | No `test` script in any manifest |
| Lint | **None** | No `lint` script, no ESLint/Prettier config |
| Format | **None** | No Prettier config |

## Usage

```powershell
cd finance-service
npm ci
npm run typecheck
npm run dev
```

## Testing — CONFIRMED ABSENT

- No `*.test.*` / `*.spec.*` files anywhere (excluding `node_modules`, `dist`).
- No `test` script, no Jest/Vitest/Mocha dependency, no test config file.
- Historical tests existed and were **deleted** in commit `33328d7` ("Remove user sync tests and related fixture files; delete unused verification and gateway routing tests"): `tests/gateway-routing.cjs`, `tests/local-access.cjs`, `*/tests/*.test.cjs`, `*/tests/*.test.mjs`, `*/tests/*.mjs`.
- `.gitignore` now ignores `tests/` and `test/` directories — new test dirs may be silently untracked. Verify with `git status` before relying on a test file existing.
- **Consequence:** the narrowest available validation is `npm run typecheck`, then `npm run build`. Do not invent a `npm test` invocation.

## Notes
- Run commands from the service folder, not the repo root.
- `npm run db:push` mutates schema without migrations — do not use against production.
- Do not invent npm scripts; `README-ID.md` explicitly warns against it.
