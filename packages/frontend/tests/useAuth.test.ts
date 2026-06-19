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
