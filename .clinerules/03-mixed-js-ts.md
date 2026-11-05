---
paths:
  - "**/*.js"
  - "**/*.cjs"
  - "**/*.mjs"
  - "**/*.ts"
  - "**/*.cts"
  - "**/*.mts"
  - "**/*.jsx"
  - "**/*.tsx"
---

# Mixed JavaScript / TypeScript rules

- Akura uses TypeScript with a CommonJS runtime. Preserve the existing package configuration and runtime behavior.
- Respect the existing language of each module. Do not mass-convert JavaScript to TypeScript.
- For new files, prefer TypeScript when the package configuration, build/runtime, and neighboring modules support it.
- Check the target service's `tsconfig.json`, `package.json`, module settings, and import conventions before changing module syntax.
- Akura uses `tsx watch` for development and `tsc` for TypeScript compilation. Preserve compatibility with the existing scripts.
- Avoid introducing `any`; use existing types, inferred types, `unknown` with narrowing, or small local interfaces as appropriate.
- When a JS module is consumed by TS, preserve runtime compatibility and update declarations/types only when required.
- Do not add `@ts-ignore` or broad `any` casts to silence errors without explaining the underlying issue.
- Preserve CommonJS/ESM boundaries. Do not casually change `require` to `import` or vice versa.
- Keep imports consistent with the repository's extension and path-alias conventions.
- Check public exports and callers before renaming or changing signatures.
- Do not modify `tsconfig.json`, module settings, or package scripts merely to make an isolated change compile without explaining the need and impact.
