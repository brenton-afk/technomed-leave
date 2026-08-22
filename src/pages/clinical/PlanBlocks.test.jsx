import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  DayBlock, SurgeonLegend, NotesCallout, KeyFlagsSection, PlanFooter, CaseBlock
} from './PlanBlocks.jsx'
import { FIXTURE_WEEK } from '../../clinicalPlan/fixture.js'
import { accentFor, accentTextFor, TOKENS } from '../../clinicalPlan/theme.js'

const MON = FIXTURE_WEEK.days[0]
const TUE = FIXTURE_WEEK.days[1]
const THU = FIXTURE_WEEK.days[3]

// The full weekly document, as the tab renders it. Held as a snapshot so any
// change to the document's structure or order has to be looked at deliberately.
function WeeklyDocument() {
  return (
    <article>
      <h2>{FIXTURE_WEEK.title}</h2>
      <div>{FIXTURE_WEEK.subtitle}</div>
      <div>{FIXTURE_WEEK.summaryLine}</div>
      <SurgeonLegend surgeons={FIXTURE_WEEK.surgeons} />
      <NotesCallout notes={FIXTURE_WEEK.notes} />
      {FIXTURE_WEEK.days.map(day => <DayBlock key={day.date} day={day} />)}
      <KeyFlagsSection keyFlags={FIXTURE_WEEK.keyFlags} />
      <PlanFooter generatedAtLabel="21 August 2026, 5:30pm AEST" />
    </article>
  )
}

describe('Weekly view (snapshot)', () => {
  it('matches the document layout for the fixture week', () => {
    const { container } = render(<WeeklyDocument />)
    expect(container.firstChild).toMatchSnapshot()
  })
})

describe('Daily view (snapshot)', () => {
  it('renders a single day with the same block styling', () => {
    const { container } = render(
      <article>
        <SurgeonLegend surgeons={FIXTURE_WEEK.surgeons} />
        <DayBlock day={TUE} headingLevel={2} />
        <PlanFooter generatedAtLabel="21 August 2026, 5:30pm AEST" />
      </article>
    )
    expect(container.firstChild).toMatchSnapshot()
  })
})

describe('Weekly view content (§6)', () => {
  it('includes the weekend, which the .docx omits', () => {
    render(<WeeklyDocument />)
    expect(screen.getByText('Saturday 29 August')).toBeInTheDocument()
    expect(screen.getByText('Sunday 30 August')).toBeInTheDocument()
  })

  it('renders all seven day headings in order', () => {
    render(<WeeklyDocument />)
    // The 8th level-3 heading is "Key flags for the week"; the days come first.
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent).slice(0, 7)
    expect(headings).toEqual([
      'Monday 24 August', 'Tuesday 25 August', 'Wednesday 26 August', 'Thursday 27 August',
      'Friday 28 August', 'Saturday 29 August', 'Sunday 30 August'
    ])
  })

  it('shows each surgeon in the legend in their own accent, as text', () => {
    render(<SurgeonLegend surgeons={FIXTURE_WEEK.surgeons} />)
    for (const surgeon of ['Fowler', 'Ibbett', 'JPW', 'Gupta']) {
      const el = screen.getByText(surgeon)
      expect(el.tagName).toBe('STRONG')
      expect(el).toHaveStyle({ color: accentTextFor(surgeon) })
    }
  })

  it('boxes the recurring staffing flag and only that', () => {
    const { container } = render(<DayBlock day={MON} />)
    const boxed = [...container.querySelectorAll('div')].filter(el =>
      el.style.borderRadius === '6px' && el.style.background === 'rgb(239, 246, 255)')
    expect(boxed).toHaveLength(1)
    expect(boxed[0].textContent).toContain("BEN: Late start / early finish (Boy's Week)")
  })

  it('gives each case a left bar in its surgeon accent', () => {
    const { container } = render(<DayBlock day={TUE} />)
    const bars = [...container.querySelectorAll('div[aria-hidden="true"]')]
      .filter(el => el.style.width === '4px')
      .map(el => el.style.background)
    // Three JPW/Gupta cases at RHH plus one Ibbett at Calvary.
    expect(bars).toHaveLength(4)
    expect(bars).toContain(hexToRgb(accentFor('Ibbett')))
    expect(bars).toContain(hexToRgb(accentFor('Gupta')))
  })

  it('renders a colour-coding fault as bold red italic under its case', () => {
    render(<DayBlock day={MON} />)
    const note = screen.getByText('■ COLOUR-CODING: no calendar colour set — should be Grape')
    expect(note).toHaveStyle({ color: TOKENS.alert, fontStyle: 'italic', fontWeight: '700' })
  })

  it('leaves case times off the plan', () => {
    // Theatre lists are reordered often enough that a time printed here is wrong
    // more often than it is right, and a wrong time is worse than none. The
    // calendar keeps them, and meetings below still carry theirs.
    render(<WeeklyDocument />)
    for (const time of ['10:00am–11:00am', '11:00am–12:00pm', '9:00am–10:00am', '1:30pm–2:30pm']) {
      expect(screen.queryAllByText(time)).toHaveLength(0)
    }
  })

  it('states each case as who, what, with what, from where — once each', () => {
    // A booking title runs the operation and the system together, and the notes
    // often name the operation too, so this used to print the operation in bold
    // and then again beneath it with the system attached — but only for the cases
    // that had notes, so the plan read differently row to row.
    render(<WeeklyDocument />)
    const block = screen.getByText('Jackson').closest('div').parentElement

    const operation = screen.getAllByText('C5/6 ACDF')
    expect(operation).toHaveLength(1)
    expect(operation[0]).toHaveStyle({ fontWeight: '700' })

    // The system stands on its own line, without the operation repeated in it.
    expect(block.textContent).toContain('MARINER')
    expect(block.textContent).not.toContain('C5/6 ACDF MARINER')
  })

  it('groups by hospital with a small caps subheading', () => {
    render(<DayBlock day={TUE} />)
    const headings = screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent)
    expect(headings).toEqual(['RHH', 'CALVARY LENAH VALLEY'])
  })

  it('renders non-surgeon items with a neutral grey bar', () => {
    const { container } = render(<DayBlock day={THU} />)
    const greyBars = [...container.querySelectorAll('div[aria-hidden="true"]')]
      .filter(el => el.style.background === hexToRgb(TOKENS.neutralBar))
    expect(greyBars).toHaveLength(3)
    expect(screen.getByText(/Spine Logistics Meeting/)).toBeInTheDocument()
  })

  it('rolls up the remaining items on an Other line', () => {
    render(<DayBlock day={MON} />)
    expect(screen.getByText(/^Other:/)).toHaveTextContent('Toni – TM Office (all day) · List Order 4:00pm–4:30pm')
  })

  it('cites both sources and the window logic in the footer', () => {
    render(<PlanFooter generatedAtLabel="21 August 2026, 5:30pm AEST" />)
    const footer = screen.getByText(/Generated from bookings@technomed.com.au/)
    expect(footer).toHaveTextContent('Staff Leave calendar entries')
    expect(footer).toHaveTextContent('Planning week runs Monday–Sunday')
    expect(footer).toHaveTextContent('21 August 2026, 5:30pm AEST')
  })

  it('keeps every key flag label from the fixture', () => {
    render(<KeyFlagsSection keyFlags={FIXTURE_WEEK.keyFlags} />)
    for (const label of ['Surgeon load', 'Team leader handover', 'Staffing', 'Travel',
      'Logistics', 'Vendor visit', 'Colour-coding check']) {
      expect(screen.getByText(`${label}:`)).toBeInTheDocument()
    }
  })
})

describe('accessibility (§10)', () => {
  it('never carries meaning by colour alone — the surgeon is always text', () => {
    render(<CaseBlock surgicalCase={MON.casesByHospital[0].cases[0]} />)
    expect(screen.getByText('Fowler')).toBeInTheDocument()
    expect(screen.getByText('Jackson')).toBeInTheDocument()
  })

  it('hides the decorative bar from assistive technology', () => {
    const { container } = render(<CaseBlock surgicalCase={MON.casesByHospital[0].cases[0]} />)
    const bar = container.querySelector('div[aria-hidden="true"]')
    expect(bar).toBeTruthy()
    expect(bar.textContent).toBe('')
  })

  it('uses a semantic heading structure so the plan is navigable', () => {
    render(<WeeklyDocument />)
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(8) // 7 days + key flags
    expect(screen.getAllByRole('heading', { level: 4 }).length).toBeGreaterThan(0)
  })

  it('labels each day section for a screen reader', () => {
    render(<DayBlock day={MON} />)
    expect(screen.getByLabelText('Monday 24 August')).toBeInTheDocument()
  })
})

// jsdom reports computed colours as rgb().
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
