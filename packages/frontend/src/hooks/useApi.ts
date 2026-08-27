import { useCallback } from 'react'
import axios from 'axios'

export function useApi(token: string | null) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  const createSearch = useCallback(async (query: string) => {
    const { data } = await axios.post('/api/searches', { query }, { headers })
    return data
  }, [token])

  const listSearches = useCallback(async () => {
    const { data } = await axios.get('/api/searches', { headers })
    return data
  }, [token])

  const getSearch = useCallback(async (searchId: string) => {
    const { data } = await axios.get(`/api/searches/${searchId}`, { headers })
    return data
  }, [token])

  const getJobs = useCallback(async (searchId: string) => {
    const { data } = await axios.get(`/api/searches/${searchId}/jobs`, { headers })
    return data
  }, [token])

  const getProfile = useCallback(async () => {
    const { data } = await axios.get('/api/auth/me', { headers })
    return data
  }, [token])

  const updateProfile = useCallback(async (email: string) => {
    const { data } = await axios.patch('/api/auth/me', { email }, { headers })
    return data
  }, [token])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { data } = await axios.post('/api/auth/change-password', { currentPassword, newPassword }, { headers })
    return data
  }, [token])

  const deleteAccount = useCallback(async () => {
    const { data } = await axios.delete('/api/auth/me', { headers })
    return data
  }, [token])

  return { createSearch, listSearches, getSearch, getJobs, getProfile, updateProfile, changePassword, deleteAccount }
}
