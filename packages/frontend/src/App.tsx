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
