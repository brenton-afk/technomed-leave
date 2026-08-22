import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DayBlock, BookingReadings } from './PlanBlocks.jsx'
import { buildWeekPlan } from '../../clinicalPlan/buildWeekPlan.js'

// Every case on the plan has to look like every other case, however its booking
// happened to be typed. That was the fault: the plan's layout followed the shape
// of the calendar entry, so a case whose notes repeated the system printed it
// twice, a case whose notes named the operation got a bold line that others did
// not, and a case with the supply written into the title lost it altogether.
//
// These bookings are the same eight cases written eight different ways. The point
// is not that each is read correctly — that is covered in parse.test.js — but that
// they all come out with the same anatomy.

const WINDOW = {
  startDate: '2026-08-24',
  endDate: '2026-08-30',
  days: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']
}

const event = (id, summary, extra = {}) => ({
  id,
  summary,
  start: { dateTime: '2026-08-24T10:00:00+10:00' },
  end: { dateTime: '2026-08-24T11:00:00+10:00' },
  location: 'RHH',
  ...extra
})

// Eight ways a rep or a coordinator might reasonably type the same kind of case.
const BOOKINGS = [
  event('b1', 'Jackson MARINER - Fowler', { description: 'C5/6 ACDF Mariner\nKit: Mariner (consignment)' }),
  event('b2', 'Horne C4/5 ACDF DAKOTA - Ibbett', { description: 'DAKOTA consignment' }),
  event('b3', 'Gill SHORELINE - Fowler', { description: 'Procedure: L4/5 TLIF with Shoreline — on loan' }),
  event('b4', 'Streets REFORM / ASCOT - JPW'),
  event('b5', 'Panthi LONESTAR (consignment) - Gupta'),
  event('b6', 'Kennedy - JPW', { description: 'C3-C6 ACDF Diplomat, consignment' }),
  event('b7', 'Vanderheim MARINER + E4 CAGES - Gupta', { description: 'Kit: TM Locking Distractor on loan' }),
  event('b8', 'Fox STRYKER CCI - Fowler', { description: 'L5/S1 ALIF\nKit: Stryker PSI loan' })
]

const plan = buildWeekPlan(BOOKINGS, WINDOW, { generatedAt: '2026-08-23T07:00:00.000Z' })
const monday = plan.days[0]

/** The visible lines of one case block, top to bottom. */
function linesOf(element) {
  return [...element.querySelectorAll('div')]
    .filter(node => !node.querySelector('div'))
    .map(node => node.textContent.trim())
    .filter(Boolean)
}

function caseBlocks(container) {
  // Each case is a flex row: the colour bar, then the text column.
  return [...container.querySelectorAll('div')]
    .filter(node => node.getAttribute('aria-hidden') === 'true' && node.parentElement)
    .map(bar => bar.parentElement)
}

describe('every case has the same anatomy', () => {
  it('reads all eight bookings as cases', () => {
    const found = monday.casesByHospital.flatMap(g => g.cases)
    expect(found).toHaveLength(BOOKINGS.length)
  })

  it('never names the system inside the operation', () => {
    for (const c of monday.casesByHospital.flatMap(g => g.cases)) {
      if (!c.system || !c.operation) continue
      for (const word of c.system.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)) {
        expect(c.operation.toLowerCase(), `${c.patient}: operation`).not.toContain(word)
      }
    }
  })

  it('never repeats the system as the kit', () => {
    // A shared manufacturer is not a repeat: "Stryker CCI" with "Stryker PSI" is
    // an implant system and a set of patient-specific instruments, two things to
    // bring. What must not happen is the kit line saying nothing the system line
    // has not already said.
    const words = value => new Set(
      String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
    for (const c of monday.casesByHospital.flatMap(g => g.cases)) {
      if (!c.system || !c.kit) continue
      expect(c.kit.toLowerCase(), c.patient).not.toBe(c.system.toLowerCase())
      const kitWords = [...words(c.kit)]
      const systemWords = words(c.system)
      // At least one word the system does not already have.
      expect(kitWords.some(w => !systemWords.has(w)), `${c.patient}: kit adds nothing`).toBe(true)
    }
  })

  it('never shows the supply twice, or buries it in another field', () => {
    for (const c of monday.casesByHospital.flatMap(g => g.cases)) {
      for (const field of ['operation', 'system', 'kit']) {
        expect(String(c[field] || ''), `${c.patient}: ${field}`)
          .not.toMatch(/consign|\bloan/i)
      }
    }
  })

  it('puts the lines in one order for every case', () => {
    const { container } = render(<DayBlock day={monday} />)
    const blocks = caseBlocks(container)
    expect(blocks.length).toBe(BOOKINGS.length)

    for (const block of blocks) {
      const lines = linesOf(block)
      // Patient / surgeon always leads.
      expect(lines[0]).toMatch(/ \/ /)
      // And no line is ever repeated inside a case.
      expect(new Set(lines).size).toBe(lines.length)
    }
  })

  it('gives the operation the same weight in every case that has one', () => {
    render(<DayBlock day={monday} />)
    const withOperation = monday.casesByHospital
      .flatMap(g => g.cases).filter(c => c.operation)
    expect(withOperation.length).toBeGreaterThan(3)
    for (const c of withOperation) {
      expect(screen.getByText(c.operation)).toHaveStyle({ fontWeight: '700' })
    }
  })

  it('shows the supply on the system line, never on one of its own', () => {
    const { container } = render(<DayBlock day={monday} />)
    for (const block of caseBlocks(container)) {
      for (const line of linesOf(block)) {
        // "Consignment" alone would mean the system line was skipped.
        expect(line).not.toBe('Consignment')
        expect(line).not.toBe('Loan')
      }
    }
  })

  it('reads the supply out of a title as readily as out of a note', () => {
    const cases = monday.casesByHospital.flatMap(g => g.cases)
    // b5 wrote it into the title, b2 into a bare note, b1 into a Kit: line.
    expect(cases.find(c => c.patient === 'Panthi').supply).toBe('Consignment')
    expect(cases.find(c => c.patient === 'Horne').supply).toBe('Consignment')
    expect(cases.find(c => c.patient === 'Jackson').supply).toBe('Consignment')
  })

  it('keeps a genuinely separate kit, and only that', () => {
    const cases = monday.casesByHospital.flatMap(g => g.cases)
    // A TechnoMed loan set and patient-specific instruments are real extras.
    expect(cases.find(c => c.patient === 'Vanderheim').kit).toBe('TM Locking Distractor')
    expect(cases.find(c => c.patient === 'Fox').kit).toBe('Stryker PSI')
    // Everything else repeats its system, so has no kit line at all.
    const withKit = cases.filter(c => c.kit).map(c => c.patient).sort()
    expect(withKit).toEqual(['Fox', 'Vanderheim'])
  })
})

describe('showing what was read', () => {
  it('lists every booking beside the plan\'s reading of it', () => {
    render(<BookingReadings readings={plan.readings} />)
    for (const booking of BOOKINGS) {
      expect(screen.getByText(booking.summary)).toBeInTheDocument()
    }
  })

  it('names each field, including the ones it could not fill', () => {
    render(<BookingReadings readings={plan.readings} />)
    for (const field of ['Patient', 'Surgeon', 'Operation', 'System', 'Supply', 'Kit']) {
      expect(screen.getAllByText(field).length).toBe(BOOKINGS.length)
    }
  })

  it('says when a booking was not counted as a case', () => {
    const withNonCase = buildWeekPlan(
      [...BOOKINGS, event('x1', 'Theatre 3 list')], WINDOW, { generatedAt: 'x' })
    render(<BookingReadings readings={withNonCase.readings} />)
    expect(screen.getByText('Theatre 3 list')).toBeInTheDocument()
    expect(screen.getByText(/Not read as a case/)).toBeInTheDocument()
  })

  it('says where a surgeon came from when it was not in the title', () => {
    const coloured = buildWeekPlan(
      [event('y1', 'Nguyen SHORELINE', { colorId: '10' })], WINDOW, { generatedAt: 'x' })
    render(<BookingReadings readings={coloured.readings} />)
    expect(screen.getByText(/from the calendar colour/)).toBeInTheDocument()
  })

  it('shows nothing at all rather than an empty panel', () => {
    const { container } = render(<BookingReadings readings={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('never shows an identifier, even though it is a diagnostic', () => {
    const risky = buildWeekPlan([
      event('z1', 'Smith UR 4457821 MARINER - Fowler', { description: 'C5/6 ACDF DOB 14/03/1958' })
    ], WINDOW, { generatedAt: 'x' })
    const { container } = render(<BookingReadings readings={risky.readings} />)
    expect(container.textContent).not.toMatch(/4457821|1958/)
  })
})
