import { useState } from 'react'
import { SearchForm } from '../components/SearchForm'
import { useApi } from '../hooks/useApi'

interface SearchPageProps {
  token: string
  onSearchCreated: (searchId: string) => void
}

export function SearchPage({ token, onSearchCreated }: SearchPageProps) {
  const { createSearch } = useApi(token)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async (query: string) => {
    setLoading(true)
    setError('')
    try {
      const result = await createSearch(query)
      onSearchCreated(result.searchId)
    } catch (err) {
      setError('Failed to start search: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <div className="hero">
        <h1 className="display">Find your next role.</h1>
        <p className="subtitle">Describe the job you want. Beacon searches company sites and ranks the best matches for you.</p>
        {error && <div className="alert alert-error" style={{ maxWidth: 560, margin: '0 auto 16px' }}>{error}</div>}
        <SearchForm onSubmit={handleSearch} loading={loading} />
      </div>
    </div>
  )
}
