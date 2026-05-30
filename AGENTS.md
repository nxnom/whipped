# AI Agent Rules

## Orientation
- **Monorepo**, pnpm workspaces. Backend = root pkg `whipped` (`src/`, TS/Node CLI + daemon).
  Frontend = `@whipped/web` (`web-ui/`, Vite + React + react-router-dom — **not Next.js**).
- **Data:** better-sqlite3 + `src/state/` (no Prisma/ORM). Shared API/contract types live in
  `src/core/api-contract.ts` — check there before defining new types.
- **API layer:** currently tRPC, migrating to **Hono + Spoosh**. Target-state rules and the tRPC
  removal steps live in `docs/api-migration.md` — don't apply them until that migration lands.
  **Real-time stays on WebSocket** via `RuntimeStateHub` (`src/server/runtime-state-hub.ts`) — keep it
  independent of the API layer; don't touch it when changing the API.
- **Tooling:** Biome (lint + format), `tsc` for typecheck. **pnpm only** — never npm/yarn.

## TypeScript & general
1. No `any` unless truly unavoidable. Reuse existing types (esp. `src/core/api-contract.ts`) before creating new ones.
2. Self-explanatory code; add a comment only when the *why* is non-obvious. No comments that restate the code.
3. Logging: backend uses the existing `pino` logger and only for meaningful errors/events — no stray `console.log`. Frontend: no `console.log` in committed code. Don't add logging unless asked.
4. Put config / magic numbers in a `constants.ts` near where they're used. Don't create single-use constants.
5. Optional chaining (`a?.b`) — never `a && "b" in a`.
6. Early returns over nested if/else.
7. Never use `useMemo`/`useCallback` (as an AI agent, avoid them entirely) unless there's a measured perf problem.
8. Blank lines between functions and logical blocks.
9. Never write scratch files, notes, or tests to the repo root — use the right subdirectory. No markdown change-logs unless explicitly requested.

## Imports
- Backend (`src/`) is ESM/NodeNext: relative imports **must** include the `.js` extension
  (`import { x } from "../core/api-contract.js"`). No path aliases on the backend.
- Frontend aliases: `@/*` → `web-ui/src/*`, `@runtime-contract`, and `@runtime-trpc` (temporary — removed once tRPC is gone).

## Frontend (web-ui)
- Use `@geckoui/geckoui` components wherever they fit instead of hand-rolling. **Load the geckoui skill**
  before using them; don't guess props.
- Icons: `lucide-react` only.
- Multiple classes on one element → `classNames` from `@/utils/classNames`.
- Components ≤ ~200 lines; split when larger.
- Placement: shared components in `web-ui/src/components/`; page-specific components co-located under the
  page in `web-ui/src/pages/<page>/`, prefixed with the page name (e.g. `SettingsHeader`).
- Splitting a large component: make a folder named after it with the entry in `index.tsx` (keep the exact
  public export so existing imports still resolve), and extract siblings — `types.ts`, `constants.ts`,
  pure `helpers.ts`, sub-components as their own `.tsx`, and fetch/mutation logic into a `useXxx` hook.
- A split-out child may call `useRead`/`useWrite` (Spoosh) directly instead of receiving fetched data via
  props — Spoosh caches and auto-invalidates, so this avoids prop-drilling. Don't change which endpoints
  are called or when.
- Routing: `react-router-dom`. Toasts: `sonner`.
- Forms (none yet): if you add one, use `react-hook-form` + `FormProvider` + GeckoUI `RHF*` components,
  with the `zod` schema in its own file — never inline in the component.

## Before declaring work done
- Run `pnpm typecheck` and, if web changed, `pnpm web:typecheck`.
- Run `pnpm lint` (Biome); use `pnpm format` to auto-format.
