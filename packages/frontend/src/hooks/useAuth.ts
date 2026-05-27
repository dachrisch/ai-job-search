import { useState, useCallback } from 'react'
import axios from 'axios'

interface AuthState {
  userId: string | null
  token: string | null
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const stored = localStorage.getItem('auth')
    return stored ? JSON.parse(stored) : { userId: null, token: null }
  })

  const register = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post('/api/auth/register', { email, password })
    setAuth({ userId: data.userId, token: data.token })
    localStorage.setItem('auth', JSON.stringify({ userId: data.userId, token: data.token }))
    return data
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post('/api/auth/login', { email, password })
    setAuth({ userId: data.userId, token: data.token })
    localStorage.setItem('auth', JSON.stringify({ userId: data.userId, token: data.token }))
    return data
  }, [])

  const setClaudeToken = useCallback(async (claudeToken: string) => {
    await axios.post(
      '/api/auth/set-claude-token',
      { claudeApiToken: claudeToken },
      { headers: { Authorization: `Bearer ${auth.token}` } }
    )
  }, [auth.token])

  const logout = useCallback(() => {
    setAuth({ userId: null, token: null })
    localStorage.removeItem('auth')
  }, [])

  return { auth, register, login, setClaudeToken, logout, isAuthenticated: !!auth.token }
}
