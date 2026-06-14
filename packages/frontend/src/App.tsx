import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { SearchPage } from './pages/SearchPage'
import { ResultsPage } from './pages/ResultsPage'
import { Footer } from './components/Footer'

type AppPage = 'auth' | 'register' | 'search' | 'results'

const pageWrap: React.CSSProperties = { minHeight: '100vh', display: 'flex', flexDirection: 'column' }
const centeredBox: React.CSSProperties = { maxWidth: '400px', margin: '40px auto', padding: '20px', flex: 1, width: '100%' }

export default function App() {
  const { auth, register, login, setClaudeToken, logout, isAuthenticated } = useAuth()
  const [currentPage, setCurrentPage] = useState<AppPage>('auth')
  const [currentSearchId, setCurrentSearchId] = useState<string>('')
  const [claudeTokenSet, setClaudeTokenSet] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [claudeApiKey, setClaudeApiKey] = useState('')
  const [error, setError] = useState('')

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await register(email, password)
      setEmail('')
      setPassword('')
      setCurrentPage('auth')
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
      setClaudeTokenSet(true)
      setCurrentPage('search')
    } catch (err) {
      setError('Failed to set Claude token: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  if (!isAuthenticated) {
    return (
      <div style={pageWrap}>
        <div style={centeredBox}>
          <h1>AI Job Search</h1>
          {error && (
            <div style={{
              color: '#d32f2f',
              backgroundColor: '#ffebee',
              padding: '10px',
              marginBottom: '15px',
              borderRadius: '4px',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}
          <form onSubmit={currentPage === 'auth' ? handleLogin : handleRegister}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ width: '100%', padding: '8px', marginBottom: '10px', display: 'block', boxSizing: 'border-box' }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ width: '100%', padding: '8px', marginBottom: '10px', display: 'block', boxSizing: 'border-box' }}
            />
            <button type="submit" style={{ width: '100%', padding: '10px' }}>
              {currentPage === 'auth' ? 'Login' : 'Register'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCurrentPage(currentPage === 'auth' ? 'register' : 'auth')
                setError('')
              }}
              style={{ width: '100%', padding: '10px', marginTop: '10px', background: 'none', border: '1px solid #ccc', cursor: 'pointer' }}
            >
              {currentPage === 'auth' ? 'Need an account? Register' : 'Already have an account? Login'}
            </button>
          </form>
        </div>
        <Footer />
      </div>
    )
  }

  if (!claudeTokenSet) {
    return (
      <div style={pageWrap}>
        <div style={centeredBox}>
          <h1>Set Up Claude API Token</h1>
          {error && (
            <div style={{
              color: '#d32f2f',
              backgroundColor: '#ffebee',
              padding: '10px',
              marginBottom: '15px',
              borderRadius: '4px',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}
          <form onSubmit={handleSetClaudeToken}>
            <input
              type="password"
              placeholder="Claude API Key (sk-...)"
              value={claudeApiKey}
              onChange={e => setClaudeApiKey(e.target.value)}
              style={{ width: '100%', padding: '8px', marginBottom: '10px', display: 'block', boxSizing: 'border-box' }}
            />
            <button type="submit" style={{ width: '100%', padding: '10px' }}>
              Save Claude Token
            </button>
          </form>
          <button onClick={logout} style={{ width: '100%', padding: '10px', marginTop: '10px' }}>
            Logout
          </button>
        </div>
        <Footer />
      </div>
    )
  }

  if (currentPage === 'results' && currentSearchId) {
    return (
      <div style={pageWrap}>
        <ResultsPage
          searchId={currentSearchId}
          token={auth.token!}
          onBack={() => setCurrentPage('search')}
        />
        <Footer />
      </div>
    )
  }

  return (
    <div style={pageWrap}>
      <SearchPage
        token={auth.token!}
        onSearchCreated={(searchId) => {
          setCurrentSearchId(searchId)
          setCurrentPage('results')
        }}
      />
      <button
        onClick={logout}
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '8px 16px'
        }}
      >
        Logout
      </button>
      <Footer />
    </div>
  )
}
