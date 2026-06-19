# Frontend Redesign — "Beacon" — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

Modernize the job-search frontend to current design standards and make the
experience **results-first**. The user cares about the jobs found, not the
crawling/ranking machinery, so the background process is demoted but not
removed. Additionally, stop prompting for the Claude API token on every
session — load it when it already exists and only ask when it is missing.

## Decisions (locked during brainstorming)

| Topic | Decision |
|-------|----------|
| Brand / wordmark | **Beacon** |
| Theme | **Indigo / Slate**, light, all-sans (no web-font dependency) |
| Styling approach | Global CSS + design tokens (CSS custom properties). **No new dependencies** (no Tailwind, no CSS Modules) |
| Process visibility | Slim status line as primary indicator; detailed progress kept but **collapsed** behind a "Search details" disclosure, closed by default |
| Token flow | Load stored Claude token if present; only show the token-setup screen when missing |

## Design tokens

Defined as CSS custom properties in `packages/frontend/src/index.css`
(new file, imported from `main.tsx`):

```
--bg:#F8FAFC        --surface:#FFFFFF     --border:#E2E8F0
--text:#0F172A      --text-muted:#64748B  --text-faint:#94A3B8
--accent:#4F46E5    --accent-hover:#4338CA --accent-soft:#EEF2FF
--ok:#059669        --ok-soft:#ECFDF5
--warn:#A6802A      --warn-soft:#FEF9EC
--danger:#DC2626    --danger-soft:#FEF2F2
--radius:12px       --radius-lg:16px
--shadow-sm:0 1px 2px rgba(15,23,42,.05)
--shadow-md:0 8px 24px rgba(15,23,42,.06)
```

Component classes (also in `index.css`): `.btn`, `.btn-primary`, `.btn-ghost`,
`.input`, `.textarea`, `.card`, `.composer`, `.composer-row`, `.chip`,
`.pill`, `.score`, `.score-ok`, `.score-warn`, `.status-line`, `.topbar`,
`.brand`, `.hero`, `.display`, `.subtle`, `.details-toggle`.

The current `index.html` `<style>` block (the `*{margin..}` reset + grey
`#f5f5f5` body) is replaced: keep a minimal reset, set `body` background to
`var(--bg)` and the system sans font stack. Tokens/classes live in `index.css`.

## Backend change — `hasClaudeToken`

The only backend touch. Goal: the frontend must know whether the logged-in
user already has a Claude token so it can skip the setup screen.

- **`packages/shared/src/types.ts`** — extend `AuthResponse`:
  ```ts
  export interface AuthResponse {
    userId: string
    token: string
    hasClaudeToken: boolean
  }
  ```
- **`packages/api/src/auth/auth.service.ts`** —
  - `loginUser`: return `hasClaudeToken: !!user.claudeApiToken`.
  - `registerUser`: return `hasClaudeToken: !!claudeApiToken` (the optional arg).
- No new endpoints. No change to `set-claude-token`, `authMiddleware`, or the
  token-validation logic in `setClaudeToken`.

## Frontend changes

### `useAuth` (`hooks/useAuth.ts`)
- Persist `hasClaudeToken` alongside `userId`/`token` in the `auth` localStorage
  blob and in state.
- `login`/`register` set it from the response.
- `setClaudeToken`: on success, update `hasClaudeToken` to `true` in state +
  localStorage (so the just-entered token is remembered for this session).
- Expose `hasClaudeToken` from the hook.

### `App.tsx` — flow + auth screens
- Routing logic: after auth, `if (!hasClaudeToken) show token-setup else show search`.
  Remove the local `claudeTokenSet` state that forced the prompt every time.
- Restyle login / register / token-setup screens with the new classes
  (`.card`, `.input`, `.btn`, error uses `--danger-soft`). Same logic, new look.
- Topbar with **Beacon** wordmark (indigo square mark + name) and a "Sign out"
  `.btn-ghost`, replacing the fixed-position logout button.

### `SearchPage` + `SearchForm`
- Centered hero: `.display` headline "Find your next role.", muted subline.
- **Composer**: textarea inside a rounded `.composer` container with the indigo
  Search button bottom-right; ⌘/Ctrl+↵ submits.
- 3 clickable example-query `.chip`s that pre-fill the textarea (e.g.
  "Remote React, EU", "Senior PM · fintech", "ML engineer, Munich").
- Replace `alert()` on failure with an inline error using `--danger-soft`.

### `ResultsPage` — results-first
- Drop the two-column grid. Single full-width column of job cards.
- **New `StatusLine` component** (`components/StatusLine.tsx`): renders the
  primary slim pill from the `useSSE` `status` + `jobs.length`:
  - running → "● Finding matches… N so far" (animated dot)
  - complete → quiet "N results"
  - failed → calm inline error + Retry
  This absorbs what `ProgressDisplay` did.
- **`SearchProgress` is kept** but rendered inside a collapsed
  `<details class="details-toggle">` labelled "Search details", below the
  status line, closed by default. Restyled to the new tokens (muted, secondary).
- The connection banners ("Connecting…", error+Reconnect) restyled to the
  new tokens; keep their logic.

### `JobCard`
- White `.card`: title, `company · location` muted meta, description excerpt.
- Match score as a soft `.score` pill — `.score-ok` (green) when `>= 80`,
  `.score-warn` (amber) otherwise — replacing the big colored block.
- "Why this match" rendered as a muted callout.
- "View job →" as an accent-colored link.

### Removed
- **`components/ProgressDisplay.tsx`** — its running/complete/failed messaging
  is folded into `StatusLine`. Deleted.
- `SearchProgress.tsx` is **not** removed (kept behind the disclosure).

## File-change summary

| File | Change |
|------|--------|
| `packages/shared/src/types.ts` | `AuthResponse.hasClaudeToken` |
| `packages/api/src/auth/auth.service.ts` | return `hasClaudeToken` from login/register |
| `packages/frontend/index.html` | replace inline `<style>` with reset + `--bg`/font |
| `packages/frontend/src/index.css` | **new** — tokens + component classes |
| `packages/frontend/src/main.tsx` | import `./index.css` |
| `packages/frontend/src/hooks/useAuth.ts` | persist/expose `hasClaudeToken` |
| `packages/frontend/src/App.tsx` | flow change + restyle auth/topbar |
| `packages/frontend/src/pages/SearchPage.tsx` | restyle hero |
| `packages/frontend/src/components/SearchForm.tsx` | composer + chips + ⌘↵ |
| `packages/frontend/src/pages/ResultsPage.tsx` | single column + StatusLine + details disclosure |
| `packages/frontend/src/components/StatusLine.tsx` | **new** |
| `packages/frontend/src/components/SearchProgress.tsx` | restyle only |
| `packages/frontend/src/components/JobCard.tsx` | redesign |
| `packages/frontend/src/components/ProgressDisplay.tsx` | **delete** |

## Testing

- Existing `packages/frontend/tests/useSSE.test.ts` must stay green (no SSE
  contract change).
- Existing API auth tests updated to assert the new `hasClaudeToken` field on
  login/register responses (true when a token exists, false otherwise).
- New frontend test: `useAuth`/`App` skips the token-setup screen when
  `hasClaudeToken` is true and shows it when false.
- Build both packages; rebuild `shared` first so api/frontend see the type.

## Out of scope

- No WebSocket changes; SSE/polling stays as-is.
- No new routing library; the existing `currentPage` state machine remains.
- No backend endpoint additions beyond the `hasClaudeToken` field.
- No dark mode (theme A is light only).
