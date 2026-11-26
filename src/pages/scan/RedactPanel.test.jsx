import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import RedactPanel from './RedactPanel.jsx'

afterEach(cleanup)

const pages = [{ id: 'a', preview: null, redacted: true }, { id: 'b', preview: null, redacted: true }]
const originals = [{ data: 'x' }, { data: 'y' }]

describe('RedactPanel', () => {
  it('shows every page as it will be sent, and asks about a page with no label found', () => {
    const onChecked = vi.fn()
    render(<RedactPanel pages={pages} originals={originals} label={{ firstName: 'Jane', surname: 'Citizen' }} surgeon="Thani"
      redaction={{ pages: [{ boxes: [{ x: 0.5, y: 0.05, w: 0.3, h: 0.1 }], dtbv: false }, { boxes: [], dtbv: false }] }}
      onLabel={() => {}} onBoxes={() => {}} checked={false} onChecked={onChecked} />)
    expect(screen.getByText('Patient label covered')).toBeTruthy()
    expect(screen.getByText(/Page 2 · no label found/)).toBeTruthy()
    fireEvent.click(document.querySelector('[data-redact-checked]'))
    expect(onChecked).toHaveBeenCalledWith(true)
    // No DTBV page: date of birth and sex are not asked for.
    expect(document.querySelector('[data-redact-dob]')).toBeNull()
  })

  it('a DTBV form asks for date of birth and sex too', () => {
    render(<RedactPanel pages={pages} originals={originals} label={{}} surgeon=""
      redaction={{ pages: [{ boxes: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }], dtbv: true }, { boxes: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }], dtbv: false }] }}
      onLabel={() => {}} onBoxes={() => {}} checked={false} onChecked={() => {}} />)
    expect(document.querySelector('[data-redact-dob]')).toBeTruthy()
    expect(document.querySelector('[data-redact-sex]')).toBeTruthy()
    expect(document.querySelector('[data-redact-checked]')).toBeNull()
  })

  it('a covering can be added on a page and handed back', () => {
    const onBoxes = vi.fn()
    render(<RedactPanel pages={pages} originals={originals} label={{}} surgeon=""
      redaction={{ pages: [{ boxes: [], dtbv: false }, { boxes: [], dtbv: false }] }}
      onLabel={() => {}} onBoxes={onBoxes} checked={false} onChecked={() => {}} />)
    fireEvent.click(document.querySelector('[data-redact-page="1"]'))
    fireEvent.click(document.querySelector('[data-redact-add]'))
    fireEvent.click(document.querySelector('[data-redact-done]'))
    expect(onBoxes).toHaveBeenCalledWith(1, [{ x: 0.35, y: 0.06, w: 0.3, h: 0.12 }])
  })

  it('draws nothing without a covering', () => {
    const { container } = render(<RedactPanel pages={pages} redaction={null} label={{}} />)
    expect(container.innerHTML).toBe('')
  })
})
