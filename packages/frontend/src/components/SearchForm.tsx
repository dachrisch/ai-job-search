import React, { useState } from 'react'

interface SearchFormProps {
  onSubmit: (query: string) => Promise<void> | void
  loading?: boolean
}

const EXAMPLES = ['Remote React, EU', 'Senior PM · fintech', 'ML engineer, Munich']

export function SearchForm({ onSubmit, loading }: SearchFormProps) {
  const [query, setQuery] = useState('')

  const submit = async () => {
    if (query.trim()) await onSubmit(query)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submit()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="composer">
        <textarea
          className="textarea"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your ideal job — role, stack, location, seniority…"
        />
        <div className="composer-row">
          <span className="faint" style={{ fontSize: 12 }}>⌘↵ to search</span>
          <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>
      <div className="chips">
        {EXAMPLES.map(ex => (
          <button type="button" key={ex} className="chip" onClick={() => setQuery(ex)}>{ex}</button>
        ))}
      </div>
    </form>
  )
}
