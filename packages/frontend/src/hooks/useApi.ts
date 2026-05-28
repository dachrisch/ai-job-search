import { useState, useCallback } from 'react'
import axios from 'axios'

export function useApi(token: string | null) {
  const createSearch = useCallback(async (query: string) => {
    const { data } = await axios.post(
      '/api/searches',
      { query },
      { headers: { Authorization: `Bearer ${token}` } }
    )
    return data
  }, [token])

  return { createSearch }
}
