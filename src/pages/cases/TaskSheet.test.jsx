import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TaskSheet from './TaskSheet.jsx'

const TASK = { id: 'e1', what: 'Order the brochures', who: 'Toni', addedBy: 'Brent', date: '2026-11-03', done: false }

describe('a task, opened', () => {
  it('says what it is and marks it done with one clear button', async () => {
    const onDone = vi.fn(async () => ({ ok: true, copies: ['2026-11-04'], projectItems: ['Order the brochures'] }))
    render(<TaskSheet task={TASK} onDone={onDone} onClose={() => {}} />)
    expect(screen.getByText('Order the brochures')).toBeInTheDocument()
    expect(screen.getByText('Toni')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Done'))
    expect(onDone).toHaveBeenCalledWith(TASK, true)
    expect(screen.getByRole('status')).toHaveTextContent('is ticked off too')
    expect(screen.getByRole('status')).toHaveTextContent('Project list updated')
  })

  it('can put a done task back', async () => {
    const onDone = vi.fn(async () => ({ ok: true }))
    render(<TaskSheet task={{ ...TASK, done: true, doneBy: 'Toni' }} onDone={onDone} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Not done/ }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.anything(), false))
  })

  it('says so when it did not save', async () => {
    render(<TaskSheet task={TASK} onDone={async () => null} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not saved'))
  })
})
