# Frontend Redesign ("Beacon") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the job-search frontend to a modern Indigo/Slate "Beacon" identity, make the experience results-first (search process demoted but kept), and stop prompting for the Claude token when one already exists.

**Architecture:** Introduce a single global stylesheet of CSS custom properties + component classes (no new deps), replacing inline `style={}` props. Add a `hasClaudeToken` flag to the auth response so the frontend can skip the token-setup screen. Fold the running/complete/failed messaging into a slim `StatusLine`; keep the detailed `SearchProgress` behind a collapsed disclosure.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + React Testing Library (frontend); Express + Mongoose + Vitest (api); shared TS types package.

---

## Notes for the implementer

- Monorepo: `packages/{shared,api,frontend}`. **Rebuild `shared` before api/frontend** when its types change: `npm run build --workspace=@job-search/shared`.
- Frontend tests: `cd packages/frontend && npm test -- --run`. Environment is jsdom, `globals: true`.
- API auth tests use `mongodb-memory-server` and are `skipIf(CI)`; run locally with `cd packages/api && npm test -- --run tests/auth.test.ts`.
- Theme reference (locked): bg `#F8FAFC`, surface `#FFFFFF`, border `#E2E8F0`, text `#0F172A`, muted `#64748B`, faint `#94A3B8`, accent `#4F46E5`, accent-hover `#4338CA`, accent-soft `#EEF2FF`, ok `#059669`, warn `#A6802A`.
- Wordmark: **Beacon**.

---

### Task 1: `hasClaudeToken` in the auth response (shared + api)

**Files:**
- Modify: `packages/shared/src/types.ts:82-85`
- Modify: `packages/api/src/auth/auth.service.ts`
- Test: `packages/api/tests/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `describe('Auth Service', ...)` block in `packages/api/tests/auth.test.ts` (after the existing "should login existing user" test):

```ts
  it('should report hasClaudeToken=false when registering without a token', async () => {
    const result = await registerUser('notoken@example.com', 'password123')
    expect(result.hasClaudeToken).toBe(false)
  })

  it('should report hasClaudeToken=true when a token exists', async () => {
    await registerUser('withtoken@example.com', 'password123', 'sk-test-123')
    const result = await loginUser('withtoken@example.com', 'password123')
    expect(result.hasClaudeToken).toBe(true)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/api && npm test -- --run tests/auth.test.ts`
Expected: the two new tests FAIL (`hasClaudeToken` is `undefined`). Existing tests pass.

- [ ] **Step 3: Update the shared type**

In `packages/shared/src/types.ts`, change `AuthResponse`:

```ts
export interface AuthResponse {
  userId: string
  token: string
  hasClaudeToken: boolean
}
```

- [ ] **Step 4: Rebuild shared**

Run: `npm run build --workspace=@job-search/shared`
Expected: builds with no errors.

- [ ] **Step 5: Return the flag from the service**

In `packages/api/src/auth/auth.service.ts`:

In `registerUser`, change the return to:
```ts
  return { userId: user._id.toString(), token, hasClaudeToken: !!claudeApiToken }
```

In `loginUser`, change the return to:
```ts
  return { userId: user._id.toString(), token, hasClaudeToken: !!user.claudeApiToken }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/api && npm test -- --run tests/auth.test.ts`
Expected: all auth tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types.ts packages/api/src/auth/auth.service.ts packages/api/tests/auth.test.ts
git commit -m "feat(auth): return hasClaudeToken from login/register"
```

---

### Task 2: Frontend test setup (jest-dom matchers)

**Files:**
- Create: `packages/frontend/vitest.setup.ts`
- Modify: `packages/frontend/vitest.config.ts`

- [ ] **Step 1: Create the setup file**

`packages/frontend/vitest.setup.ts`:
```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 2: Register it in vitest config**

In `packages/frontend/vitest.config.ts`, change `setupFiles: []` to:
```ts
    setupFiles: ['./vitest.setup.ts'],
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd packages/frontend && npm test -- --run`
Expected: existing `useSSE` tests PASS (jest-dom import does not break them).

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/vitest.setup.ts packages/frontend/vitest.config.ts
git commit -m "test(frontend): load jest-dom matchers via setup file"
```

---

### Task 3: Design tokens + global stylesheet (no tests — styling foundation)

**Files:**
- Create: `packages/frontend/src/index.css`
- Modify: `packages/frontend/src/main.tsx`
- Modify: `packages/frontend/index.html`

- [ ] **Step 1: Create `packages/frontend/src/index.css`**

```css
:root {
  --bg: #F8FAFC;
  --surface: #FFFFFF;
  --border: #E2E8F0;
  --text: #0F172A;
  --text-muted: #64748B;
  --text-faint: #94A3B8;
  --accent: #4F46E5;
  --accent-hover: #4338CA;
  --accent-soft: #EEF2FF;
  --ok: #059669;
  --ok-soft: #ECFDF5;
  --warn: #A6802A;
  --warn-soft: #FEF9EC;
  --danger: #DC2626;
  --danger-soft: #FEF2F2;
  --radius: 12px;
  --radius-lg: 16px;
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, .05);
  --shadow-md: 0 8px 24px rgba(15, 23, 42, .06);
  --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font-sans);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Layout */
.app { min-height: 100vh; display: flex; flex-direction: column; }
.main { flex: 1; width: 100%; }
.container { max-width: 760px; margin: 0 auto; padding: 32px 20px; }
.container-wide { max-width: 920px; margin: 0 auto; padding: 32px 20px; }
.center-narrow { max-width: 400px; margin: 48px auto; padding: 0 20px; width: 100%; }

/* Topbar */
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px; border-bottom: 1px solid var(--border); background: var(--surface);
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 15px; letter-spacing: -.01em; color: var(--text); }
.brand-mark { width: 22px; height: 22px; border-radius: 6px; background: var(--accent); display: flex; align-items: center; justify-content: center; }
.brand-mark::after { content: ''; width: 8px; height: 8px; border-radius: 2px; background: var(--surface); }

/* Typography */
.display { font-size: 44px; line-height: 1.05; letter-spacing: -.025em; font-weight: 700; color: var(--text); }
.subtitle { color: var(--text-muted); font-size: 17px; line-height: 1.5; }
.muted { color: var(--text-muted); }
.faint { color: var(--text-faint); }
.label { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-faint); }

/* Hero */
.hero { text-align: center; padding: 72px 0 56px; }
.hero .display { margin-bottom: 14px; }
.hero .subtitle { max-width: 440px; margin: 0 auto 36px; }

/* Buttons */
.btn {
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  border-radius: 10px; padding: 9px 18px; font-size: 14px; font-weight: 560;
  font-family: inherit; cursor: pointer; transition: background .12s, border-color .12s;
}
.btn:hover { background: #F1F5F9; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-primary:hover { background: var(--accent-hover); }
.btn-ghost { background: none; border-color: transparent; color: var(--text-muted); }
.btn-ghost:hover { background: #F1F5F9; }
.btn-block { width: 100%; }

/* Inputs */
.input, .textarea {
  width: 100%; font-family: inherit; font-size: 15px; color: var(--text);
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 11px 12px; outline: none; transition: border-color .12s, box-shadow .12s;
}
.input:focus, .textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.textarea { min-height: 56px; resize: vertical; }

/* Composer */
.composer {
  max-width: 560px; margin: 0 auto; background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: 16px 16px 12px; text-align: left; box-shadow: var(--shadow-sm);
}
.composer .textarea { border: none; padding: 4px; min-height: 46px; }
.composer .textarea:focus { box-shadow: none; }
.composer-row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }

/* Chips */
.chips { margin-top: 28px; display: flex; gap: 9px; justify-content: center; flex-wrap: wrap; }
.chip { background: var(--surface); border: 1px solid var(--border); color: var(--text-muted); font-size: 13px; padding: 6px 13px; border-radius: 99px; cursor: pointer; font-family: inherit; }
.chip:hover { border-color: var(--accent); color: var(--accent); }

/* Card */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 22px; box-shadow: var(--shadow-sm); }

/* Status line */
.status-line { display: inline-flex; align-items: center; gap: 9px; color: var(--text-muted); font-size: 14px; background: var(--surface); border: 1px solid var(--border); padding: 8px 15px; border-radius: 99px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

/* Job card bits */
.job-list { display: flex; flex-direction: column; gap: 14px; margin-top: 18px; }
.job-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.job-title { font-size: 18px; font-weight: 650; color: var(--text); letter-spacing: -.01em; margin-bottom: 4px; }
.job-meta { color: var(--text-muted); font-size: 14px; margin-bottom: 12px; }
.job-desc { color: var(--text-muted); font-size: 14px; line-height: 1.5; margin-bottom: 12px; }
.job-why { font-size: 14px; color: var(--text); line-height: 1.5; background: var(--accent-soft); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; }
.job-link { font-size: 14px; font-weight: 560; }

.score { flex: none; text-align: center; border-radius: 10px; padding: 8px 13px; }
.score b { display: block; font-size: 20px; line-height: 1; }
.score small { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
.score-ok { background: var(--ok-soft); }
.score-ok b { color: var(--ok); }
.score-ok small { color: var(--ok); }
.score-warn { background: var(--warn-soft); }
.score-warn b { color: var(--warn); }
.score-warn small { color: var(--warn); }

/* Disclosure (search details) */
.details-toggle { margin-top: 16px; }
.details-toggle > summary { cursor: pointer; color: var(--text-muted); font-size: 13px; list-style: none; user-select: none; padding: 6px 0; }
.details-toggle > summary::-webkit-details-marker { display: none; }
.details-toggle > summary::before { content: '▸ '; color: var(--text-faint); }
.details-toggle[open] > summary::before { content: '▾ '; }

/* Banners / alerts */
.alert { padding: 12px 14px; border-radius: 10px; font-size: 14px; margin-bottom: 16px; }
.alert-error { background: var(--danger-soft); color: var(--danger); border: 1px solid #FCA5A5; }
.alert-info { background: var(--accent-soft); color: var(--accent); border: 1px solid #C7D2FE; }

/* Progress (inside disclosure) */
.progress-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); }
.progress-row:last-child { border-bottom: none; }
.progress-row .k { color: var(--text-muted); font-size: 14px; }
.progress-row .v { font-weight: 650; font-size: 16px; color: var(--text); }
```

- [ ] **Step 2: Import the stylesheet in `packages/frontend/src/main.tsx`**

Add as the first import line:
```ts
import './index.css'
```

- [ ] **Step 3: Strip the inline `<style>` from `packages/frontend/index.html`**

Replace the `<style>...</style>` block in `index.html` with nothing (delete it). The `<head>` keeps only charset, viewport, and title. `index.css` now owns the reset and body styles.

- [ ] **Step 4: Verify build**

Run: `cd packages/frontend && npx vite build`
Expected: build succeeds, `index.css` is bundled. (Note: `tsc` build may OOM locally per project memory — `vite build` is the check here.)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/index.css packages/frontend/src/main.tsx packages/frontend/index.html
git commit -m "feat(frontend): add Indigo/Slate design tokens and global stylesheet"
```

---

### Task 4: `useAuth` persists and exposes `hasClaudeToken`

**Files:**
- Modify: `packages/frontend/src/hooks/useAuth.ts`
- Test: `packages/frontend/tests/useAuth.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/useAuth.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import axios from 'axios'
import { useAuth } from '../src/hooks/useAuth'

vi.mock('axios')

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('stores hasClaudeToken from the login response', async () => {
    ;(axios.post as any).mockResolvedValue({
      data: { userId: 'u1', token: 't1', hasClaudeToken: true },
    })
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.login('a@b.com', 'pw')
    })
    expect(result.current.hasClaudeToken).toBe(true)
    expect(JSON.parse(localStorage.getItem('auth')!).hasClaudeToken).toBe(true)
  })

  it('flips hasClaudeToken to true after setClaudeToken succeeds', async () => {
    ;(axios.post as any).mockResolvedValue({
      data: { userId: 'u1', token: 't1', hasClaudeToken: false },
    })
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.login('a@b.com', 'pw')
    })
    expect(result.current.hasClaudeToken).toBe(false)
    ;(axios.post as any).mockResolvedValue({ data: { success: true } })
    await act(async () => {
      await result.current.setClaudeToken('sk-123')
    })
    expect(result.current.hasClaudeToken).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npm test -- --run tests/useAuth.test.ts`
Expected: FAIL — `hasClaudeToken` is `undefined` on the hook result.

- [ ] **Step 3: Implement**

Replace `packages/frontend/src/hooks/useAuth.ts` with:
```ts
import { useState, useCallback } from 'react'
import axios from 'axios'

interface AuthState {
  userId: string | null
  token: string | null
  hasClaudeToken: boolean
}

const EMPTY: AuthState = { userId: null, token: null, hasClaudeToken: false }

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const stored = localStorage.getItem('auth')
    return stored ? { ...EMPTY, ...JSON.parse(stored) } : EMPTY
  })

  const persist = (next: AuthState) => {
    setAuth(next)
    localStorage.setItem('auth', JSON.stringify(next))
  }

  const register = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post('/api/auth/register', { email, password })
    persist({ userId: data.userId, token: data.token, hasClaudeToken: !!data.hasClaudeToken })
    return data
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post('/api/auth/login', { email, password })
    persist({ userId: data.userId, token: data.token, hasClaudeToken: !!data.hasClaudeToken })
    return data
  }, [])

  const setClaudeToken = useCallback(async (claudeToken: string) => {
    await axios.post(
      '/api/auth/set-claude-token',
      { claudeApiToken: claudeToken },
      { headers: { Authorization: `Bearer ${auth.token}` } }
    )
    persist({ ...auth, hasClaudeToken: true })
  }, [auth])

  const logout = useCallback(() => {
    setAuth(EMPTY)
    localStorage.removeItem('auth')
  }, [])

  return {
    auth,
    register,
    login,
    setClaudeToken,
    logout,
    isAuthenticated: !!auth.token,
    hasClaudeToken: auth.hasClaudeToken,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npm test -- --run tests/useAuth.test.ts`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useAuth.ts packages/frontend/tests/useAuth.test.ts
git commit -m "feat(frontend): persist and expose hasClaudeToken in useAuth"
```

---

### Task 5: `App` skips the token screen when a token exists; restyle auth + topbar

**Files:**
- Modify: `packages/frontend/src/App.tsx`
- Test: `packages/frontend/tests/App.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/App.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../src/App'

function seedAuth(hasClaudeToken: boolean) {
  localStorage.setItem('auth', JSON.stringify({ userId: 'u1', token: 't1', hasClaudeToken }))
}

describe('App routing', () => {
  beforeEach(() => localStorage.clear())

  it('goes straight to search when the Claude token already exists', () => {
    seedAuth(true)
    render(<App />)
    expect(screen.getByText('Find your next role.')).toBeInTheDocument()
    expect(screen.queryByText(/Claude API/i)).not.toBeInTheDocument()
  })

  it('shows the token setup screen when the token is missing', () => {
    seedAuth(false)
    render(<App />)
    expect(screen.getByText(/Connect your Claude API key/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npm test -- --run tests/App.test.tsx`
Expected: FAIL — the headline text and routing don't exist yet.

- [ ] **Step 3: Implement `App.tsx`**

Replace `packages/frontend/src/App.tsx` with:
```tsx
import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { SearchPage } from './pages/SearchPage'
import { ResultsPage } from './pages/ResultsPage'
import { Footer } from './components/Footer'

type AppPage = 'auth' | 'register' | 'search' | 'results'

function Brand() {
  return (
    <div className="brand"><span className="brand-mark" /> Beacon</div>
  )
}

export default function App() {
  const { auth, register, login, setClaudeToken, logout, isAuthenticated, hasClaudeToken } = useAuth()
  const [currentPage, setCurrentPage] = useState<AppPage>('auth')
  const [currentSearchId, setCurrentSearchId] = useState<string>('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const [error, setError] = useState('')

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await register(email, password)
      setEmail(''); setPassword(''); setCurrentPage('auth')
    } catch (err) {
      setError('Registration failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await login(email, password)
      setCurrentPage('search')
    } catch (err) {
      setError('Login failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  const handleSetClaudeToken = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await setClaudeToken(claudeApiKey)
      setCurrentPage('search')
    } catch (err) {
      setError('Failed to set Claude token: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  if (!isAuthenticated) {
    const isLogin = currentPage !== 'register'
    return (
      <div className="app">
        <div className="main"><div className="center-narrow">
          <h1 className="display" style={{ fontSize: 32, marginBottom: 24 }}>Beacon</h1>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={isLogin ? handleLogin : handleRegister}>
            <input className="input" type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} style={{ marginBottom: 10 }} />
            <input className="input" type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)} style={{ marginBottom: 14 }} />
            <button type="submit" className="btn btn-primary btn-block">
              {isLogin ? 'Sign in' : 'Create account'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 10 }}
              onClick={() => { setCurrentPage(isLogin ? 'register' : 'auth'); setError('') }}>
              {isLogin ? 'Need an account? Register' : 'Already have an account? Sign in'}
            </button>
          </form>
        </div></div>
        <Footer />
      </div>
    )
  }

  if (!hasClaudeToken) {
    return (
      <div className="app">
        <div className="main"><div className="center-narrow">
          <h1 className="display" style={{ fontSize: 28, marginBottom: 8 }}>Connect your Claude API key</h1>
          <p className="subtitle" style={{ fontSize: 15, marginBottom: 24 }}>
            Beacon uses your Claude key to search and rank jobs. It is stored securely and only asked for once.
          </p>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleSetClaudeToken}>
            <input className="input" type="password" placeholder="Claude API Key (sk-...)" value={claudeApiKey}
              onChange={e => setClaudeApiKey(e.target.value)} style={{ marginBottom: 14 }} />
            <button type="submit" className="btn btn-primary btn-block">Save key</button>
          </form>
          <button onClick={logout} className="btn btn-ghost btn-block" style={{ marginTop: 10 }}>Sign out</button>
        </div></div>
        <Footer />
      </div>
    )
  }

  if (currentPage === 'results' && currentSearchId) {
    return (
      <div className="app">
        <div className="topbar"><Brand /><button className="btn btn-ghost" onClick={() => setCurrentPage('search')}>New search</button></div>
        <div className="main">
          <ResultsPage searchId={currentSearchId} token={auth.token!} onBack={() => setCurrentPage('search')} />
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="topbar"><Brand /><button className="btn btn-ghost" onClick={logout}>Sign out</button></div>
      <div className="main">
        <SearchPage token={auth.token!} onSearchCreated={(searchId) => { setCurrentSearchId(searchId); setCurrentPage('results') }} />
      </div>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npm test -- --run tests/App.test.tsx`
Expected: both tests PASS. (Depends on `SearchPage` rendering "Find your next role." — implemented in Task 6/7. If running this task in isolation before 7, the first assertion will fail; run Tasks 6–7 then re-run. Subagent-driven execution runs tasks in order, so this passes once Task 7 lands. To keep this task green standalone, the SearchPage headline string is fixed as "Find your next role." in Task 7.)

> Implementer note: Task 5 and Task 7 both reference the headline `Find your next role.`. If executing strictly task-by-task, run Task 7 before re-confirming Task 5's first assertion. Commit Task 5 after its second assertion passes; the first is fully green after Task 7.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/App.tsx packages/frontend/tests/App.test.tsx
git commit -m "feat(frontend): skip token screen when present; restyle auth + topbar"
```

---

### Task 6: `SearchForm` — composer, example chips, ⌘/Ctrl+Enter

**Files:**
- Modify: `packages/frontend/src/components/SearchForm.tsx`
- Test: `packages/frontend/tests/SearchForm.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/SearchForm.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchForm } from '../src/components/SearchForm'

describe('SearchForm', () => {
  it('pre-fills the textarea when an example chip is clicked', () => {
    render(<SearchForm onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByText('Remote React, EU'))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Remote React, EU')
  })

  it('submits on Cmd/Ctrl+Enter', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<SearchForm onSubmit={onSubmit} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'python dev' } })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(onSubmit).toHaveBeenCalledWith('python dev')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npm test -- --run tests/SearchForm.test.tsx`
Expected: FAIL — chips and key handler don't exist.

- [ ] **Step 3: Implement `SearchForm.tsx`**

```tsx
import React, { useState } from 'react'

interface SearchFormProps {
  onSubmit: (query: string) => Promise<void> | void
  loading?: boolean
}

const EXAMPLES = ['Remote React, EU', 'Senior PM · fintech', 'ML engineer, Munich']

export function SearchForm({ onSubmit, loading }: SearchFormProps) {
  const [query, setQuery] = useState('')

  const submit = async () => {
    if (query.trim()) await onSubmit(query)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submit()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="composer">
        <textarea
          className="textarea"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your ideal job — role, stack, location, seniority…"
        />
        <div className="composer-row">
          <span className="faint" style={{ fontSize: 12 }}>⌘↵ to search</span>
          <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>
      <div className="chips">
        {EXAMPLES.map(ex => (
          <button type="button" key={ex} className="chip" onClick={() => setQuery(ex)}>{ex}</button>
        ))}
      </div>
    </form>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npm test -- --run tests/SearchForm.test.tsx`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/SearchForm.tsx packages/frontend/tests/SearchForm.test.tsx
git commit -m "feat(frontend): composer-style search form with example chips and Cmd+Enter"
```

---

### Task 7: `SearchPage` hero restyle

**Files:**
- Modify: `packages/frontend/src/pages/SearchPage.tsx`
- Test: covered by `tests/App.test.tsx` (Task 5) — the "Find your next role." assertion.

- [ ] **Step 1: Implement `SearchPage.tsx`**

```tsx
import { useState } from 'react'
import { SearchForm } from '../components/SearchForm'
import { useApi } from '../hooks/useApi'

interface SearchPageProps {
  token: string
  onSearchCreated: (searchId: string) => void
}

export function SearchPage({ token, onSearchCreated }: SearchPageProps) {
  const { createSearch } = useApi(token)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async (query: string) => {
    setLoading(true)
    setError('')
    try {
      const result = await createSearch(query)
      onSearchCreated(result.searchId)
    } catch (err) {
      setError('Failed to start search: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <div className="hero">
        <h1 className="display">Find your next role.</h1>
        <p className="subtitle">Describe the job you want. Beacon searches company sites and ranks the best matches for you.</p>
        {error && <div className="alert alert-error" style={{ maxWidth: 560, margin: '0 auto 16px' }}>{error}</div>}
        <SearchForm onSubmit={handleSearch} loading={loading} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run the App + SearchForm tests**

Run: `cd packages/frontend && npm test -- --run tests/App.test.tsx tests/SearchForm.test.tsx`
Expected: all PASS (including App's "Find your next role." assertion).

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/SearchPage.tsx
git commit -m "feat(frontend): restyle search hero"
```

---

### Task 8: `StatusLine` component (absorbs ProgressDisplay messaging)

**Files:**
- Create: `packages/frontend/src/components/StatusLine.tsx`
- Test: `packages/frontend/tests/StatusLine.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/StatusLine.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusLine } from '../src/components/StatusLine'

describe('StatusLine', () => {
  it('shows live count while running', () => {
    render(<StatusLine status="running" jobsFound={12} onRetry={vi.fn()} />)
    expect(screen.getByText(/Finding matches/i)).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()
  })

  it('shows a quiet result count when complete', () => {
    render(<StatusLine status="complete" jobsFound={24} onRetry={vi.fn()} />)
    expect(screen.getByText(/24 results/i)).toBeInTheDocument()
  })

  it('shows a retry affordance when failed', () => {
    const onRetry = vi.fn()
    render(<StatusLine status="failed" jobsFound={0} onRetry={onRetry} />)
    expect(screen.getByText(/Retry/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npm test -- --run tests/StatusLine.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `StatusLine.tsx`**

```tsx
interface StatusLineProps {
  status: 'running' | 'complete' | 'failed'
  jobsFound: number
  onRetry: () => void
}

export function StatusLine({ status, jobsFound, onRetry }: StatusLineProps) {
  if (status === 'failed') {
    return (
      <div className="alert alert-error" style={{ display: 'inline-flex', gap: 12, alignItems: 'center' }}>
        <span>Search failed.</span>
        <button className="btn" onClick={onRetry}>Retry</button>
      </div>
    )
  }

  if (status === 'running') {
    return (
      <span className="status-line"><span className="status-dot" /> Finding matches… {jobsFound} so far</span>
    )
  }

  return <span className="status-line">{jobsFound} results</span>
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npm test -- --run tests/StatusLine.test.tsx`
Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/StatusLine.tsx packages/frontend/tests/StatusLine.test.tsx
git commit -m "feat(frontend): add slim StatusLine for search progress"
```

---

### Task 9: `JobCard` redesign (soft score pill by threshold)

**Files:**
- Modify: `packages/frontend/src/components/JobCard.tsx`
- Test: `packages/frontend/tests/JobCard.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/JobCard.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { JobCard } from '../src/components/JobCard'

const base = {
  id: '1', title: 'Backend Engineer', company: 'Acme', description: 'x'.repeat(50),
  url: 'https://example.com', location: 'Remote', matchReasoning: 'good fit',
}

describe('JobCard', () => {
  it('uses the ok score style for scores >= 80', () => {
    const { container } = render(<JobCard job={{ ...base, matchScore: 92 }} />)
    expect(container.querySelector('.score-ok')).not.toBeNull()
    expect(container.querySelector('.score-warn')).toBeNull()
  })

  it('uses the warn score style for scores < 80', () => {
    const { container } = render(<JobCard job={{ ...base, matchScore: 64 }} />)
    expect(container.querySelector('.score-warn')).not.toBeNull()
    expect(container.querySelector('.score-ok')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npm test -- --run tests/JobCard.test.tsx`
Expected: FAIL — `.score-ok` / `.score-warn` classes not present.

- [ ] **Step 3: Implement `JobCard.tsx`**

```tsx
interface Job {
  id: string
  title: string
  company: string
  description: string
  url: string
  salary?: string
  location: string
  matchScore: number
  matchReasoning: string
}

interface JobCardProps {
  job: Job
}

export function JobCard({ job }: JobCardProps) {
  const scoreClass = job.matchScore >= 80 ? 'score-ok' : 'score-warn'
  return (
    <div className="card">
      <div className="job-top">
        <div style={{ flex: 1 }}>
          <h3 className="job-title">{job.title}</h3>
          <p className="job-meta">{job.company} · {job.location}{job.salary ? ` · ${job.salary}` : ''}</p>
          <p className="job-desc">{job.description.substring(0, 200)}…</p>
        </div>
        <div className={`score ${scoreClass}`}>
          <b>{Math.round(job.matchScore)}</b>
          <small>Match</small>
        </div>
      </div>
      <p className="job-why"><strong>Why this match:</strong> {job.matchReasoning}</p>
      <a className="job-link" href={job.url} target="_blank" rel="noopener noreferrer">View job →</a>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/frontend && npm test -- --run tests/JobCard.test.tsx`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/JobCard.tsx packages/frontend/tests/JobCard.test.tsx
git commit -m "feat(frontend): redesign JobCard with soft score pill"
```

---

### Task 10: `ResultsPage` results-first; demote `SearchProgress`; delete `ProgressDisplay`

**Files:**
- Modify: `packages/frontend/src/pages/ResultsPage.tsx`
- Modify: `packages/frontend/src/components/SearchProgress.tsx` (restyle only)
- Delete: `packages/frontend/src/components/ProgressDisplay.tsx`
- Test: `packages/frontend/tests/ResultsPage.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/tests/ResultsPage.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultsPage } from '../src/pages/ResultsPage'

vi.mock('../src/hooks/useSSE', () => ({
  useSSE: () => ({ status: 'running', iterationCount: 1, jobs: [], isConnected: true, error: null }),
}))
// SearchProgress fetches on mount; stub global fetch so it doesn't error.
beforeEach(() => {
  localStorage.setItem('auth', JSON.stringify({ userId: 'u1', token: 't1', hasClaudeToken: true }))
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'running' }) }) as any
})

describe('ResultsPage', () => {
  it('shows the slim status line', () => {
    render(<ResultsPage searchId="s1" token="t1" onBack={vi.fn()} />)
    expect(screen.getByText(/Finding matches/i)).toBeInTheDocument()
  })

  it('keeps search details collapsed by default', () => {
    const { container } = render(<ResultsPage searchId="s1" token="t1" onBack={vi.fn()} />)
    const details = container.querySelector('details.details-toggle') as HTMLDetailsElement
    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/frontend && npm test -- --run tests/ResultsPage.test.tsx`
Expected: FAIL — no `StatusLine`/`details.details-toggle` yet.

- [ ] **Step 3: Implement `ResultsPage.tsx`**

```tsx
import { useState } from 'react'
import { useSSE } from '../hooks/useSSE'
import { StatusLine } from '../components/StatusLine'
import { SearchProgress } from '../components/SearchProgress'
import { JobList } from '../components/JobList'

interface ResultsPageProps {
  searchId: string
  token: string
  onBack: () => void
}

export function ResultsPage({ searchId, token, onBack }: ResultsPageProps) {
  const { status, jobs, isConnected, error } = useSSE(searchId, token)
  const [, setLoadMoreCallCount] = useState(0)

  const handleLoadMore = () => setLoadMoreCallCount(prev => prev + 1)
  const isSearchRunning = status === 'running'

  return (
    <div className="container-wide">
      {!isConnected && error && (
        <div className="alert alert-error">
          <p>{error}</p>
          <button className="btn" onClick={() => window.location.reload()}>Reconnect</button>
        </div>
      )}
      {!isConnected && !error && (
        <div className="alert alert-info">Connecting to search stream…</div>
      )}

      <StatusLine status={status} jobsFound={jobs.length} onRetry={onBack} />

      <details className="details-toggle">
        <summary>Search details</summary>
        <SearchProgress searchId={searchId} />
      </details>

      <div className="job-list">
        <JobList searchId={searchId} onLoadMore={handleLoadMore} isLoading={isSearchRunning} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Restyle `SearchProgress.tsx`**

In `packages/frontend/src/components/SearchProgress.tsx`, replace inline-styled wrappers with the new classes. Specifically:
- The loading / error / no-status / main wrapper `<div style={{...}}>` → `<div className="card">` (error case → `<div className="alert alert-error">`).
- Remove the centered status-header block and the `@keyframes spin` `<style>` (the running indicator now lives in `StatusLine`).
- Replace each `ProgressItem` wrapper with the `.progress-row` markup:

```tsx
function ProgressItem({ label, value }: ProgressItemProps) {
  return (
    <div className="progress-row">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  )
}
```
- The "companies remaining" note → `<div className="alert alert-info" style={{ marginTop: 12 }}>`.

Keep all data-fetching/polling logic unchanged.

- [ ] **Step 5: Delete `ProgressDisplay.tsx`**

Run: `git rm packages/frontend/src/components/ProgressDisplay.tsx`
Confirm no remaining imports: `grep -rn ProgressDisplay packages/frontend/src` → expect no matches.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd packages/frontend && npm test -- --run tests/ResultsPage.test.tsx`
Expected: both tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/ResultsPage.tsx packages/frontend/src/components/SearchProgress.tsx packages/frontend/tests/ResultsPage.test.tsx
git rm packages/frontend/src/components/ProgressDisplay.tsx
git commit -m "feat(frontend): results-first ResultsPage with demoted, collapsible progress"
```

---

### Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend suite**

Run: `cd packages/frontend && npm test -- --run`
Expected: all tests PASS (useSSE, useAuth, App, SearchForm, StatusLine, JobCard, ResultsPage).

- [ ] **Step 2: Build the frontend**

Run: `cd packages/frontend && npx vite build`
Expected: build succeeds.

- [ ] **Step 3: Run the api auth tests (local, needs Mongo memory server)**

Run: `cd packages/api && npm test -- --run tests/auth.test.ts`
Expected: all auth tests PASS, including the two `hasClaudeToken` cases.

- [ ] **Step 4: Confirm no dangling references**

Run: `grep -rn "ProgressDisplay\|iterationCount" packages/frontend/src`
Expected: no `ProgressDisplay` matches. (`iterationCount` is fine if still destructured elsewhere, but ResultsPage no longer needs it.)

- [ ] **Step 5: Manual smoke (optional, requires servyy-test infra + running services)**

Per `./scripts/dev-startup.sh`: sign in with an account that already has a Claude token → lands directly on the search hero (no token prompt). Run a search → results page shows the slim status line, jobs fill the page, "Search details" is collapsed and expands to the progress breakdown.
```
```
```
```

## Self-review notes
- Spec coverage: design tokens (T3), hasClaudeToken backend (T1) + frontend flow (T4, T5), search hero/composer/chips (T6, T7), StatusLine absorbing ProgressDisplay (T8, T10), JobCard redesign (T9), results-first layout + demoted SearchProgress + ProgressDisplay deletion (T10), auth/topbar restyle (T5), testing (T1–T11). All covered.
- Type consistency: `AuthResponse.hasClaudeToken` (T1) used in `useAuth` (T4) and `App` (T5); `StatusLine` props `{status, jobsFound, onRetry}` defined T8, consumed identically T10; `JobCard` Job shape unchanged.
- Cross-task dependency (T5↔T7 headline string) is called out explicitly with the resolution.
