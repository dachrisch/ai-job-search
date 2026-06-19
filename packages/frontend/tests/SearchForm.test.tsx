import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SearchForm } from '../src/components/SearchForm'

describe('SearchForm', () => {
  it('pre-fills the textarea when an example chip is clicked', () => {
    render(<SearchForm onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByText('Remote React, EU'))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Remote React, EU')
  })

  it('submits on Cmd/Ctrl+Enter', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<SearchForm onSubmit={onSubmit} />)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: 'python dev' } })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    expect(onSubmit).toHaveBeenCalledWith('python dev')
  })
})
