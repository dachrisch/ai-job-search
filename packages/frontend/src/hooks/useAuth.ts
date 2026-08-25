import { useState, useCallback } from 'react'
import axios from 'axios'

interface AuthState {
  userId: string | null
  token: string | null
}

const EMPTY: AuthState = { userId: null, token: null }

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
    persist({ userId: data.userId, token: data.token })
    return data
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await axios.post('/api/auth/login', { email, password })
    persist({ userId: data.userId, token: data.token })
    return data
  }, [])

  const logout = useCallback(() => {
    setAuth(EMPTY)
    localStorage.removeItem('auth')
  }, [])

  return {
    auth,
    register,
    login,
    logout,
    isAuthenticated: !!auth.token,
  }
}