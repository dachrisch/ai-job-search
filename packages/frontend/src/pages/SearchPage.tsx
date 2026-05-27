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

  const handleSearch = async (query: string) => {
    setLoading(true)
    try {
      const result = await createSearch(query)
      onSearchCreated(result.searchId)
    } catch (error) {
      alert('Failed to create search: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ marginBottom: '10px' }}>AI-Powered Job Search</h1>
      <p style={{ color: '#666', marginBottom: '30px' }}>
        Describe your ideal job and let AI find the best matches from company websites.
      </p>
      <SearchForm onSubmit={handleSearch} loading={loading} />
    </div>
  )
}
