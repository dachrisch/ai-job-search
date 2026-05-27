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

  const getSearchStatus = useCallback(async (searchId: string) => {
    const { data } = await axios.get(
      `/api/searches/${searchId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    return data
  }, [token])

  const getSearchResults = useCallback(async (searchId: string) => {
    const { data } = await axios.get(
      `/api/searches/${searchId}/jobs`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    return data
  }, [token])

  return { createSearch, getSearchStatus, getSearchResults }
}
