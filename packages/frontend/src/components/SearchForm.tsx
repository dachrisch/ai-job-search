import React, { useState } from 'react'

interface SearchFormProps {
  onSubmit: (query: string) => Promise<void>
  loading?: boolean
}

export function SearchForm({ onSubmit, loading }: SearchFormProps) {
  const [query, setQuery] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      await onSubmit(query)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
      <textarea
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Describe your ideal job (e.g., 'Remote Python backend developer in Berlin')"
        style={{
          width: '100%',
          minHeight: '80px',
          padding: '10px',
          fontSize: '16px',
          fontFamily: 'inherit'
        }}
      />
      <button
        type="submit"
        disabled={loading || !query.trim()}
        style={{
          marginTop: '10px',
          padding: '10px 20px',
          fontSize: '16px',
          cursor: 'pointer'
        }}
      >
        {loading ? 'Searching...' : 'Search Jobs'}
      </button>
    </form>
  )
}
