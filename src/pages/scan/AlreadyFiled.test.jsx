import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AlreadyFiled } from '../UsageScan.jsx'

// Invented patient. The Matthews double-up of 6 Nov 2026, as the rep now sees it.
const earlier = { id: 'a', folderName: 'Testa_06112026_Gupta_PLIF+Fixation+Boost-UF_CLV', by: 'Mat Usher', at: '2026-11-06T06:56:00Z', sentTo: ['Device Technologies Boost Allograft'] }

describe('a scan of a case already filed', () => {
  it('says it is already filed and sent, and that nothing was filed or sent again', () => {
    render(<AlreadyFiled duplicate={{ kind: 'identical', earlier, added: [] }} onDiscard={() => {}} onAmend={() => {}} onSeparate={() => {}} />)
    expect(screen.getByText('This usage is already filed')).toBeInTheDocument()
    expect(screen.getByText(/sent to Device Technologies Boost Allograft/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing from this scan has been filed or sent/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Amend the earlier case' })).not.toBeInTheDocument()
  })

  it('offers Amend for what is new, and names it', () => {
    const onAmend = vi.fn()
    render(<AlreadyFiled duplicate={{ kind: 'adds', earlier, added: [{ productName: 'Boost', lotNumber: 'AB-999', quantity: 1 }] }}
      onDiscard={() => {}} onAmend={onAmend} onSeparate={() => {}} />)
    expect(screen.getByText(/1 × Boost \(AB-999\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Amend the earlier case' }))
    expect(onAmend).toHaveBeenCalled()
  })

  it('files it separately only when the rep says it is a different operation', () => {
    const onSeparate = vi.fn()
    render(<AlreadyFiled duplicate={{ kind: 'folder', earlier: { folderName: 'Testa_06112026_Gupta_ACDF_CLV' }, added: [] }}
      onDiscard={() => {}} onAmend={() => {}} onSeparate={onSeparate} />)
    expect(screen.getByText('A case is already filed for this patient today')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /different operation/ }))
    expect(onSeparate).toHaveBeenCalled()
  })
})
