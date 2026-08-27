import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import axios from 'axios'

interface AuthState {
  userId: string | null
  token: string | null
}

interface AuthContextValue {
  auth: AuthState
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const EMPTY: AuthState = { userId: null, token: null }
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => {
    const stored = localStorage.getItem('auth')
    return stored ? { ...EMPTY, ...JSON.parse(stored) } : EMPTY
  })

  const persist = (next: AuthState) => {
    setAuth(next)
    localStorage.setItem('auth', JSON.stringify(next))
  }

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post('/api/auth/login', { email, password })
    persist({ userId: data.userId, token: data.token })
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post('/api/auth/register', { email, password })
    persist({ userId: data.userId, token: data.token })
  }, [])

  const logout = useCallback(async () => {
    try {
      if (auth.token) {
        await axios.post('/api/auth/logout', null, {
          headers: { Authorization: `Bearer ${auth.token}` }
        })
      }
    } catch {
      // Ignore errors — clear local state regardless
    }
    setAuth(EMPTY)
    localStorage.removeItem('auth')
  }, [auth.token])

  return (
    <AuthContext.Provider value={{ auth, isAuthenticated: !!auth.token, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider')
  return ctx
}
