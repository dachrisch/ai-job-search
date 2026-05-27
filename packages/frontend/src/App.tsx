import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { SearchPage } from './pages/SearchPage'
import { ResultsPage } from './pages/ResultsPage'

type AppPage = 'auth' | 'search' | 'results'

export default function App() {
  const { auth, register, login, setClaudeToken, logout, isAuthenticated } = useAuth()
  const [currentPage, setCurrentPage] = useState<AppPage>('auth')
  const [currentSearchId, setCurrentSearchId] = useState<string>('')
  const [claudeTokenSet, setClaudeTokenSet] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [claudeApiKey, setClaudeApiKey] = useState('')

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await register(email, password)
      alert('Registered successfully!')
    } catch (error) {
      alert('Registration failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
      setCurrentPage('search')
    } catch (error) {
      alert('Login failed: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleSetClaudeToken = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await setClaudeToken(claudeApiKey)
      setClaudeTokenSet(true)
      setCurrentPage('search')
    } catch (error) {
      alert('Failed to set Claude token: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  if (!isAuthenticated) {
    return (
      <div style={{ maxWidth: '400px', margin: '40px auto', padding: '20px' }}>
        <h1>AI Job Search</h1>
        <form onSubmit={currentPage === 'auth' ? handleLogin : handleRegister}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px', display: 'block' }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px', display: 'block' }}
          />
          <button type="submit" style={{ width: '100%', padding: '10px' }}>
            {currentPage === 'auth' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    )
  }

  if (!claudeTokenSet) {
    return (
      <div style={{ maxWidth: '400px', margin: '40px auto', padding: '20px' }}>
        <h1>Set Up Claude API Token</h1>
        <form onSubmit={handleSetClaudeToken}>
          <input
            type="password"
            placeholder="Claude API Key (sk-...)"
            value={claudeApiKey}
            onChange={e => setClaudeApiKey(e.target.value)}
            style={{ width: '100%', padding: '8px', marginBottom: '10px', display: 'block' }}
          />
          <button type="submit" style={{ width: '100%', padding: '10px' }}>
            Save Claude Token
          </button>
        </form>
        <button onClick={logout} style={{ width: '100%', padding: '10px', marginTop: '10px' }}>
          Logout
        </button>
      </div>
    )
  }

  if (currentPage === 'results' && currentSearchId) {
    return (
      <ResultsPage
        searchId={currentSearchId}
        token={auth.token!}
        onBack={() => setCurrentPage('search')}
      />
    )
  }

  return (
    <>
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
    </>
  )
}
