import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '../App.jsx'
import { type, colour } from './tokens.js'
import * as icons from './icons.jsx'

const ADMIN = {
  name: 'Brenton Lovering', email: 'brenton@technomed.com.au',
  isAdmin: true, token: 'tok-admin',
  staff: { hasTimesheets: false, role: 'Managing Director' }
}
const REP = {
  name: 'Ben Cassidy', email: 'ben@technomed.com.au',
  isAdmin: false, token: 'tok-ben',
  staff: { hasTimesheets: true, role: 'Clinical Support Specialist' }
}

function signIn(user) {
  sessionStorage.setItem('tm_user', JSON.stringify(user))
  sessionStorage.setItem('tm_login_time', String(Date.now()))
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  // Every screen in the app fetches something; nothing here depends on the data.
  global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({}) }))
})

describe('bottom navigation', () => {
  it('shows five tabs for an admin', async () => {
    signIn(ADMIN)
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const labels = [...nav.querySelectorAll('button')].map(b => b.textContent)
    expect(labels).toEqual(['Cases', 'Scan', 'Kit', 'Me', 'Admin'])
  })

  it('hides Admin from everyone else', () => {
    signIn(REP)
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const labels = [...nav.querySelectorAll('button')].map(b => b.textContent)
    expect(labels).toEqual(['Cases', 'Scan', 'Kit', 'Me'])
    expect(labels).not.toContain('Admin')
  })

  it('never exceeds five tabs — the point of the restructure', () => {
    signIn(ADMIN)
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav.querySelectorAll('button').length).toBeLessThanOrEqual(5)
  })

  it('marks the current tab for assistive technology, not just colour', () => {
    signIn(REP)
    render(<App />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const current = [...nav.querySelectorAll('button')].filter(b => b.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toBe('Cases')
  })

  it('opens a hub rather than a screen when a section tab is tapped', async () => {
    signIn(REP)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Kit/ }))
    // A hub is a list of cards; these are its contents.
    await waitFor(() => expect(screen.getByText('Kit Room')).toBeInTheDocument())
    expect(screen.getByText('Resources')).toBeInTheDocument()
    expect(screen.getByText('Stock take')).toBeInTheDocument()
  })

  it('opens straight onto the case plan, with no Today screen', async () => {
    signIn(REP)
    render(<App />)
    // The plan is the front door: a view switcher, not a hub of cards.
    await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Plan view' })).toBeInTheDocument())
    expect(screen.queryByText(/Scan a usage form/)).not.toBeInTheDocument()
  })
})

describe('hub contents (the agreed structure)', () => {
  it('Kit carries kit, stock, resources, projects and the calendar view', async () => {
    signIn(REP)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Kit/ }))
    for (const label of ['Kit Room', 'Stock take', 'Resources', 'Projects & actions', 'Calendar view']) {
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument())
    }
  })

  it('Me carries timesheets, leave, payslips, files and account', async () => {
    signIn(REP)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /^Me$/ }))
    for (const label of ['Timesheets', 'Leave', 'Payslips', 'Filed usage sheets', 'Sign-in & Face ID', 'Log out']) {
      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument())
    }
  })

  it('disables Timesheets for someone whose role has none', async () => {
    signIn(ADMIN) // hasTimesheets: false
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /^Me$/ }))
    await waitFor(() => expect(screen.getByText('Not required for your role')).toBeInTheDocument())
  })

  it('navigates into a section and back out again', async () => {
    signIn(REP)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Kit/ }))
    await waitFor(() => expect(screen.getByText('Stock take')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Stock take'))
    await waitFor(() => expect(screen.getByText('Not set up yet')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    // Back returns to the hub, not out to the case plan.
    await waitFor(() => expect(screen.getByText('Kit Room')).toBeInTheDocument())
  })

  it('does not render the admin portal for a non-admin', () => {
    signIn(REP)
    render(<App />)
    // The tab is not rendered, but the state is still reachable in principle.
    expect(screen.queryByText('Leave Applications')).not.toBeInTheDocument()
  })
})

describe('icon set', () => {
  const names = Object.keys(icons).filter(k => k.startsWith('Icon'))

  it('exports an icon for every tab and card', () => {
    for (const required of ['IconScan', 'IconCases', 'IconKit', 'IconMe', 'IconAdmin']) {
      expect(names).toContain(required)
    }
    expect(names.length).toBeGreaterThanOrEqual(18)
  })

  it('draws every icon on the same 24 grid, stroked not filled', () => {
    for (const name of names) {
      const { container, unmount } = render(icons[name]({ size: 24 }))
      const svg = container.querySelector('svg')
      expect(svg, name).toBeTruthy()
      expect(svg.getAttribute('viewBox'), name).toBe('0 0 24 24')
      expect(svg.getAttribute('fill'), name).toBe('none')
      expect(svg.getAttribute('stroke-linecap'), name).toBe('round')
      unmount()
    }
  })

  it('hides icons from screen readers, since every one sits beside a label', () => {
    for (const name of names) {
      const { container, unmount } = render(icons[name]({}))
      expect(container.querySelector('svg').getAttribute('aria-hidden'), name).toBe('true')
      unmount()
    }
  })

  it('takes colour from the surrounding text by default', () => {
    const { container } = render(icons.IconToday({}))
    expect(container.querySelector('svg').getAttribute('stroke')).toBe('currentColor')
  })
})

describe('design tokens', () => {
  it('keeps the type scale closed — this is what stops sizes multiplying', () => {
    expect(Object.keys(type)).toEqual(
      ['display', 'title', 'heading', 'body', 'bodyStrong', 'caption', 'micro'])
  })

  it('has exactly one accent, with the rest neutral or semantic', () => {
    // The old app had five decorative accents competing for attention.
    const decorative = ['accent', 'accentSoft', 'accentDeep']
    const semantic = ['warning', 'warningSoft', 'warningLine', 'danger', 'dangerSoft', 'dangerLine', 'success', 'successSoft']
    const brand = ['navy', 'navyDeep', 'navySoft']
    const neutral = ['ink', 'inkMuted', 'inkFaint', 'inkFainter', 'line', 'lineSoft', 'surface', 'canvas']
    expect(Object.keys(colour).sort()).toEqual([...decorative, ...semantic, ...brand, ...neutral].sort())
  })

  it('uses valid hex throughout', () => {
    for (const [name, value] of Object.entries(colour)) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
