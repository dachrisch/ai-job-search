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
