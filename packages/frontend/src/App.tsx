import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, Link } from 'react-router-dom'
import { useAuthContext } from './hooks/AuthContext'
import { SearchPage } from './pages/SearchPage'
import { ResultsPage } from './pages/ResultsPage'
import { InsightsPage } from './pages/InsightsPage'
import { HistoryPage } from './pages/HistoryPage'
import { ProfilePage } from './pages/ProfilePage'
import { Footer } from './components/Footer'

function Brand() {
  return (
    <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
      <span className="brand-mark" /> Beacon
    </Link>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthContext()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function LoginPage() {
  const { login } = useAuthContext()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError('Login failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  return (
    <div className="app">
      <div className="main"><div className="center-narrow">
        <h1 className="display" style={{ fontSize: 32, marginBottom: 24 }}>Beacon</h1>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <input className="input" type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} style={{ marginBottom: 10 }} />
          <input className="input" type="password" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)} style={{ marginBottom: 14 }} />
          <button type="submit" className="btn btn-primary btn-block">Sign in</button>
          <Link to="/register" className="btn btn-ghost btn-block" style={{ marginTop: 10, textAlign: 'center' }}>
            Need an account? Register
          </Link>
        </form>
      </div></div>
      <Footer />
    </div>
  )
}

function RegisterPage() {
  const { register } = useAuthContext()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await register(email, password)
      navigate('/')
    } catch (err) {
      setError('Registration failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    }
  }

  return (
    <div className="app">
      <div className="main"><div className="center-narrow">
        <h1 className="display" style={{ fontSize: 32, marginBottom: 24 }}>Beacon</h1>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <input className="input" type="email" placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)} style={{ marginBottom: 10 }} />
          <input className="input" type="password" placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)} style={{ marginBottom: 14 }} />
          <button type="submit" className="btn btn-primary btn-block">Create account</button>
          <Link to="/login" className="btn btn-ghost btn-block" style={{ marginTop: 10, textAlign: 'center' }}>
            Already have an account? Sign in
          </Link>
        </form>
      </div></div>
      <Footer />
    </div>
  )
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <div className="topbar">
        <Brand />
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/history" className="btn btn-ghost">History</Link>
          <Link to="/profile" className="btn btn-ghost">Profile</Link>
        </div>
      </div>
      <div className="main">{children}</div>
      <Footer />
    </div>
  )
}

function SearchPageWrapper() {
  const { auth } = useAuthContext()
  const navigate = useNavigate()
  return (
    <AppLayout>
      <SearchPage token={auth.token!} onSearchCreated={(searchId) => navigate(`/search/${searchId}`)} />
    </AppLayout>
  )
}

function ResultsPageWrapper() {
  const { auth } = useAuthContext()
  return (
    <div className="app">
      <div className="topbar">
        <Brand />
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/history" className="btn btn-ghost">History</Link>
          <Link to="/profile" className="btn btn-ghost">Profile</Link>
        </div>
      </div>
      <div className="main">
        <ResultsPage token={auth.token!} />
      </div>
      <Footer />
    </div>
  )
}

function InsightsPageWrapper() {
  const { auth } = useAuthContext()
  return (
    <div className="app">
      <div className="topbar">
        <Brand />
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/history" className="btn btn-ghost">History</Link>
          <Link to="/profile" className="btn btn-ghost">Profile</Link>
        </div>
      </div>
      <div className="main">
        <InsightsPage token={auth.token!} />
      </div>
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<ProtectedRoute><SearchPageWrapper /></ProtectedRoute>} />
      <Route path="/history" element={<ProtectedRoute><AppLayout><HistoryPage /></AppLayout></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><AppLayout><ProfilePage /></AppLayout></ProtectedRoute>} />
      <Route path="/search/:id" element={<ProtectedRoute><ResultsPageWrapper /></ProtectedRoute>} />
      <Route path="/search/:id/insights" element={<ProtectedRoute><InsightsPageWrapper /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
