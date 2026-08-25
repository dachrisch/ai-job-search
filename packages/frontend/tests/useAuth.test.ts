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

  it('stores userId and token from the login response', async () => {
    ;(axios.post as any).mockResolvedValue({
      data: { userId: 'u1', token: 't1' },
    })
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.login('a@b.com', 'pw')
    })
    expect(result.current.isAuthenticated).toBe(true)
    expect(JSON.parse(localStorage.getItem('auth')!)).toMatchObject({ userId: 'u1', token: 't1' })
  })

  it('logs out and clears localStorage', async () => {
    ;(axios.post as any).mockResolvedValue({
      data: { userId: 'u1', token: 't1' },
    })
    const { result } = renderHook(() => useAuth())
    await act(async () => {
      await result.current.login('a@b.com', 'pw')
    })
    act(() => {
      result.current.logout()
    })
    expect(result.current.isAuthenticated).toBe(false)
    expect(localStorage.getItem('auth')).toBeNull()
  })
})