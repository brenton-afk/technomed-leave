import { describe, it, expect, vi } from 'vitest'
import { buildWeekPlan } from './buildWeekPlan.js'
import { weekWindowFor } from './week.js'
import { colourNameFor } from './colours.js'
import { accentFor, accentTextFor, hasConfirmedAccent, contrastRatio, SURGEON_ACCENTS, TOKENS } from './theme.js'

const WINDOW = weekWindowFor('2026-08-24')
const GENERATED = '2026-08-21T17:30:00+10:00'

// Google colorIds, by the name the team picks in Calendar.
const COLOR = { Grape: '3', Flamingo: '4', Banana: '5', Graphite: '8', Basil: '10', Tomato: '11' }

const ev = (id, summary, day, from, to, extra = {}) => ({
  id,
  summary,
  start: { dateTime: `2026-08-${day}T${from}:00+10:00` },
  end: { dateTime: `2026-08-${day}T${to}:00+10:00` },
  ...extra
})
const allDayEv = (id, summary, day) => ({
  id, summary,
  start: { date: `2026-08-${day}` },
  end: { date: `2026-08-${day}` }
})

function build(events) {
  return buildWeekPlan(events, WINDOW, { generatedAt: GENERATED })
}

describe('buildWeekPlan structure', () => {
  it('always returns seven days, Monday to Sunday', () => {
    const plan = build([])
    expect(plan.days).toHaveLength(7)
    expect(plan.days.map(d => d.weekday)).toEqual(
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
    expect(plan.weekStart).toBe('2026-08-24')
    expect(plan.weekEnd).toBe('2026-08-30')
  })

  it('reports an empty week without inventing content', () => {
    const plan = build([])
    expect(plan.surgeons).toEqual([])
    expect(plan.days.every(d => d.caseCountLine === 'No surgical cases')).toBe(true)
    expect(plan.summaryLine).toMatch(/No surgical cases/)
  })

  it('groups cases by hospital with RHH first, chronological within', () => {
    const plan = build([
      ev('c1', 'Horne DAKOTA - Ibbett', '25', '09:00', '10:00', { location: 'Calvary Lenah Valley', colorId: COLOR.Banana }),
      ev('c2', 'Streets LONESTAR - JPW', '25', '12:00', '13:00', { location: 'RHH', colorId: COLOR.Flamingo }),
      ev('c3', 'Kennedy REFORM - JPW', '25', '10:00', '11:00', { location: 'RHH', colorId: COLOR.Flamingo })
    ])
    const tue = plan.days[1]
    expect(tue.casesByHospital.map(g => g.hospital)).toEqual(['RHH', 'CALVARY LENAH VALLEY'])
    expect(tue.casesByHospital[0].cases.map(c => c.patient)).toEqual(['Kennedy', 'Streets'])
    expect(tue.caseCountLine).toBe('3 cases — 2 RHH, 1 Calvary')
  })

  it('keeps real start and end times on every case', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { location: 'RHH', colorId: COLOR.Grape })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.start).toBe('2026-08-24T10:00:00+10:00')
    expect(c.end).toBe('2026-08-24T11:00:00+10:00')
  })

  it('places a case on the Hobart day it starts', () => {
    // 08:30 Hobart on the 25th is 22:30Z on the 24th — a naive UTC read would
    // put this on Monday.
    const plan = build([{
      id: 'c1', summary: 'Horne DAKOTA - Ibbett', location: 'RHH', colorId: COLOR.Banana,
      start: { dateTime: '2026-08-24T22:30:00Z' }, end: { dateTime: '2026-08-24T23:30:00Z' }
    }])
    expect(plan.days[0].casesByHospital).toHaveLength(0)
    expect(plan.days[1].casesByHospital[0].cases[0].patient).toBe('Horne')
  })

  it('never leaks internal derivation fields into the plan', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { colorId: COLOR.Grape })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c).not.toHaveProperty('_event')
    expect(c).not.toHaveProperty('dayDate')
  })
})

describe('flags and non-case classification', () => {
  it('boxes only the recurring staffing flag', () => {
    const plan = build([
      ev('f1', "BEN: Late start / early finish (Boy's Week)", '24', '08:00', '09:00'),
      ev('f2', '5:00pm — Handover: Ben becomes Spine Team Leader', '24', '17:00', '17:30')
    ])
    const flags = plan.days[0].flags
    const boxed = flags.filter(f => f.boxed)
    expect(boxed).toHaveLength(1)
    expect(boxed[0].kind).toBe('recurringStaffing')
    expect(flags.find(f => f.kind === 'handover').boxed).toBe(false)
  })

  it('sorts the boxed flag first, so it renders above the rest', () => {
    const plan = build([
      ev('f1', 'Brent departs — NSA Conference', '25', '15:30', '16:00'),
      ev('f2', 'BEN: Late start / early finish', '25', '08:00', '09:00')
    ])
    expect(plan.days[1].flags[0].boxed).toBe(true)
  })

  it('gives meetings their own block and rolls routine markers into Other', () => {
    const plan = build([
      ev('m1', 'Spine Logistics Meeting (Erin, Brent, Toni, Ben, Mat)', '27', '13:00', '14:00'),
      allDayEv('o1', 'Toni – WFH', '27'),
      ev('o2', 'List Order', '27', '16:00', '16:30')
    ])
    const thu = plan.days[3]
    expect(thu.nonSurgeonItems).toHaveLength(1)
    expect(thu.nonSurgeonItems[0].text).toContain('1:00pm–2:00pm')
    expect(thu.otherRollup.map(o => o.text)).toEqual(
      expect.arrayContaining([expect.stringContaining('WFH'), expect.stringContaining('List Order')]))
    expect(thu.caseCountLine).toBe('No surgical cases — 1 internal meeting')
  })
})

describe('colour comes from the calendar (no checking)', () => {
  // The plan used to keep its own table of surgeon colours, draw from that, and
  // report any disagreement with Google as a fault — in a note telling the reader
  // something they could already see on the booking. Taking the colour from the
  // booking removes the disagreement and the note together.
  it('draws a case in the colour its booking carries', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00',
      { colorId: COLOR.Basil, location: 'RHH' })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.colourHex).toBe('#0b8043')      // Basil
    expect(c.calendarColorName).toBe('Basil')
  })

  it('says nothing about a colour that disagrees with the guide', () => {
    // Fowler's guide colour is Grape; this booking is Basil. That is now simply
    // what colour the case is.
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00',
      { colorId: COLOR.Basil, location: 'RHH' })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.notes).toEqual([])
    expect(plan.notes).not.toMatch(/colour/i)
    expect(plan.keyFlags.map(f => f.label)).not.toContain('Colour-coding check')
  })

  it('says nothing about a booking with no colour set either', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { location: 'RHH' })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.notes).toEqual([])
    expect(c.colourHex).toBeUndefined()      // falls back to the surgeon's accent
  })

  it('leaves nothing about colour on a non-surgical entry', () => {
    const plan = build([ev('x', 'Brent on call', '24', '09:00', '10:00', { colorId: COLOR.Graphite })])
    expect(plan.notes).not.toMatch(/colour/i)
  })
})

describe('key flags (§6.7)', () => {
  it('reports per-surgeon load with days and hospitals', () => {
    const plan = build([
      ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { location: 'RHH', colorId: COLOR.Grape }),
      ev('c2', 'Gill STRYKER - Fowler', '24', '11:00', '12:00', { location: 'RHH', colorId: COLOR.Grape }),
      ev('c3', 'Horne DAKOTA - Ibbett', '25', '09:00', '10:00', { location: 'Calvary', colorId: COLOR.Banana })
    ])
    const load = plan.keyFlags.find(f => f.label === 'Surgeon load').text
    expect(load).toMatch(/Fowler \(2 cases Mon, RHH\)/)
    expect(load).toMatch(/Ibbett \(1 case Tue, Calvary\)/)
  })

  it('adds no flags at all to a week with nothing in it', () => {
    // Every flag has to be earned by something in the week. A section that is
    // always present teaches people to stop reading it.
    expect(build([]).keyFlags).toEqual([])
  })

  it('surfaces handover, travel and staffing as their own labels', () => {
    const plan = build([
      ev('f1', 'Handover: Ben becomes Spine Team Leader', '28', '17:00', '17:30'),
      ev('f2', 'Brent departs — NSA Conference, South Australia', '25', '15:30', '16:00'),
      ev('f3', 'BEN: Late start / early finish', '24', '08:00', '09:00')
    ])
    const labels = plan.keyFlags.map(f => f.label)
    expect(labels).toContain('Team leader handover')
    expect(labels).toContain('Travel')
    expect(labels).toContain('Staffing')
  })
})

describe('derived prose', () => {
  it('counts cases and surgeons in the summary line', () => {
    const plan = build([
      ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { colorId: COLOR.Grape }),
      ev('c2', 'Horne DAKOTA - Ibbett', '25', '09:00', '10:00', { colorId: COLOR.Banana })
    ])
    expect(plan.summaryLine).toMatch(/^2 surgical cases across two surgeons/)
  })

  it('does not open the week with an uncoloured booking', () => {
    // A booking with no colour is an administrative tidy-up, not the headline.
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00')])
    expect(plan.notes).not.toMatch(/missing their calendar colour/)
  })

  it('opens the week with someone away, since that changes who can cover', () => {
    const plan = build([ev('t', 'Brent — NSA Conference, South Australia', '25', '15:30', '16:00')])
    expect(plan.notes).toMatch(/NSA Conference/)
  })

  it('does not open the week with the on-call rota', () => {
    // A standing arrangement, and it appears on its own day regardless.
    const plan = build([ev('x', 'Brent on call', '24', '09:00', '10:00')])
    expect(plan.notes).not.toMatch(/on call/i)
    expect(plan.days[0].flags.some(f => /on call/i.test(f.text))).toBe(true)
  })

  it('does not open the week with the team leader handover', () => {
    const plan = build([ev('h', 'Handover: Ben becomes Team Leader', '28', '17:00', '17:30')])
    expect(plan.notes).not.toMatch(/handover|team leader/i)
    expect(plan.summaryLine).not.toMatch(/handover|team leader/i)
    // Still on Friday, where it happens.
    expect(plan.days[4].flags.some(f => /Team Leader/.test(f.text))).toBe(true)
  })

  it('carries both the date range and the hospitals in the subtitle', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { location: 'RHH', colorId: COLOR.Grape })])
    expect(plan.subtitle).toMatch(/Monday 24/)
    expect(plan.subtitle).toMatch(/Friday 28/)
    expect(plan.subtitle).toMatch(/RHH/)
  })
})

describe('surgeons without a confirmed accent (§11.10)', () => {
  it('falls back to neutral grey and logs, rather than crashing or guessing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(hasConfirmedAccent('Hannan')).toBe(false)
    expect(hasConfirmedAccent('Dubey')).toBe(false)
    expect(accentFor('Hannan')).toBe('#9CA3AF')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Hannan'))
    warn.mockRestore()
  })

  it('builds a plan for an uncoloured surgeon without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plan = build([ev('c1', 'Someone ANY KIT - Hannan', '24', '10:00', '11:00')])
    expect(plan.surgeons).toEqual(['Hannan'])
    warn.mockRestore()
  })
})

describe('accessibility of the accent palette (§10)', () => {
  it('every surgeon name is legible as text on white (AA 4.5:1)', () => {
    // The raw document accents are decorative and some are far too light for
    // text — Ibbett's #FBBC04 is only 1.71:1 — so text uses a darkened variant
    // while the coloured bar keeps the document's exact colour.
    for (const surgeon of Object.keys(SURGEON_ACCENTS)) {
      const ratio = contrastRatio(accentTextFor(surgeon), '#FFFFFF')
      expect(ratio, `${surgeon} text ${accentTextFor(surgeon)} = ${ratio.toFixed(2)}`)
        .toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the document accent for the bar, unmodified', () => {
    // Fidelity to §5.3: the bar is decoration next to a text label, so it is
    // not held to a text contrast ratio.
    expect(accentFor('Ibbett')).toBe('#FBBC04')
    expect(accentFor('Gupta')).toBe('#16A34A')
  })

  it('darkens only the accents that need it, and never lightens', () => {
    for (const [surgeon, hex] of Object.entries(SURGEON_ACCENTS)) {
      const text = accentTextFor(surgeon)
      if (contrastRatio(hex, '#FFFFFF') >= 4.5) {
        // Already legible — must be returned untouched.
        expect(text, surgeon).toBe(hex)
      } else {
        // Adjusted, and only ever darker (same hue, more contrast).
        expect(contrastRatio(text, '#FFFFFF'), surgeon).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(text, '#FFFFFF')).toBeGreaterThan(contrastRatio(hex, '#FFFFFF'))
      }
    }
  })

  it('structural body text meets AA against its own background', () => {
    expect(contrastRatio(TOKENS.ink, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TOKENS.inkMuted, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TOKENS.inkFaint, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TOKENS.flagText, TOKENS.flagBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TOKENS.inkMuted, TOKENS.notesBg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(TOKENS.alert, '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('nothing on the calendar may disappear (§ the missing-case bug)', () => {
  it('surfaces a booking whose surgeon is not on the list', () => {
    // The failure that hid a real case: the title parses only for a known
    // surgeon, so a locum or a spelling variant demoted it to italic "Other"
    // text and it stopped being counted.
    const plan = build([ev('c1', 'Nguyen DIPLOMAT - Kowalski', '24', '10:00', '11:00', { location: 'RHH' })])
    const mon = plan.days[0]

    expect(mon.casesByHospital).toHaveLength(0)
    expect(mon.needsAttention).toHaveLength(1)
    expect(mon.needsAttention[0].text).toContain('Nguyen DIPLOMAT - Kowalski')
    expect(mon.needsAttention[0].reason).toMatch(/surgeon was not recognised/)
    // And it is impossible to miss at week level too.
    expect(plan.keyFlags.find(f => f.label === 'Bookings needing attention').text)
      .toContain('Nguyen DIPLOMAT - Kowalski')
  })

  it('surfaces a booking wearing a surgeon colour that does not parse', () => {
    const plan = build([ev('c1', 'Theatre 3 list', '24', '08:00', '12:00', { colorId: COLOR.Grape })])
    expect(plan.days[0].needsAttention).toHaveLength(1)
    expect(plan.days[0].needsAttention[0].reason).toMatch(/Coloured as a surgeon/)
  })

  it('keeps an untitled booking visible instead of dropping it', () => {
    // `if (!title) continue` used to remove the event with no trace at all.
    const plan = build([ev('c1', '', '24', '10:00', '11:00')])
    const shown = [
      ...plan.days[0].otherRollup.map(o => o.text),
      ...plan.days[0].needsAttention.map(n => n.text)
    ].join(' ')
    expect(shown).toContain('untitled booking')
  })

  it('does not cry wolf over routine entries', () => {
    const plan = build([
      ev('a', 'List Order', '24', '16:00', '16:30'),
      allDayEv('b', 'Toni – WFH', '24'),
      ev('c', 'Spine Logistics Meeting (Erin, Brent)', '24', '13:00', '14:00'),
      ev('d', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { colorId: COLOR.Grape })
    ])
    expect(plan.days[0].needsAttention).toHaveLength(0)
    expect(plan.keyFlags.some(f => f.label === 'Bookings needing attention')).toBe(false)
  })

  it('every timed booking ends up somewhere a reader will see it', () => {
    const titles = [
      'Jackson MARINER - Fowler',      // a case
      'Nguyen DIPLOMAT - Kowalski',    // unknown surgeon
      'Brent on call',                 // a flag
      'Spine Logistics Meeting',       // a grey-bar block
      'List Order',                    // the Other line
      ''                               // untitled
    ]
    const plan = build(titles.map((t, i) => ev(`e${i}`, t, '24', `0${i + 1}:00`, `0${i + 2}:00`)))
    const mon = plan.days[0]
    const accountedFor =
      mon.casesByHospital.flatMap(g => g.cases).length +
      mon.flags.length + mon.nonSurgeonItems.length +
      mon.otherRollup.length + mon.needsAttention.length
    expect(accountedFor).toBe(titles.length)
  })
})

describe('operation description from the notes', () => {
  it('reads the operation and keeps the system alongside it', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00',
      { colorId: COLOR.Grape, description: 'C5/6 ACDF\nKit: Mariner set' })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.operation).toBe('C5/6 ACDF')
    expect(c.system).toBe('MARINER')
    // "Mariner set" beside system MARINER is the same thing said twice, so it
    // does not earn a line of its own.
    expect(c.kit).toBeUndefined()
  })

  it('shows the supply against the system instead of repeating it', () => {
    const plan = build([ev('c1', 'Horne DAKOTA - Ibbett', '24', '09:00', '10:00',
      { colorId: COLOR.Banana, description: 'Kit: Dakota (consignment)' })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.system).toBe('DAKOTA')
    expect(c.supply).toBe('Consignment')
    expect(c.kit).toBeUndefined()
  })

  it('keeps a kit that names something the system does not', () => {
    // Patient-specific instruments alongside the implant system: two things to
    // physically bring, so collapsing them would lose one.
    const plan = build([ev('c1', 'Gill STRYKER CCI - Fowler', '24', '11:00', '12:00',
      { colorId: COLOR.Grape, description: 'Kit: Stryker PSI on loan' })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.system).toBe('STRYKER CCI')
    expect(c.supply).toBe('Loan')
    expect(c.kit).toBe('Stryker PSI')
  })

  it('splits an operation out of the title, so it is never said twice', () => {
    // The real shape that showed the fault: the title carries the operation and
    // the system together, and the notes name the operation as well. Rendering
    // both fields then printed "C4/5 ACDF" in bold and "C4/5 ACDF SHORELINE"
    // underneath it.
    const plan = build([ev('c1', 'Panthi C4/5 ACDF SHORELINE - Gupta', '25', '13:30', '14:30',
      { colorId: COLOR.Basil, description: 'C4/5 ACDF' })])
    const c = plan.days[1].casesByHospital[0].cases[0]
    expect(c.operation).toBe('C4/5 ACDF')
    expect(c.system).toBe('SHORELINE')
  })

  it('finds the operation in the title when the notes are empty', () => {
    const plan = build([ev('c1', 'Horne L4-L5 TLIF DAKOTA-2 - Ibbett', '24', '09:00', '10:00',
      { colorId: COLOR.Banana })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.operation).toBe('L4-L5 TLIF')
    // A hyphenated system name survives, since the title is split on what reads
    // clinically rather than on punctuation.
    expect(c.system).toBe('DAKOTA-2')
  })

  it('drops a booking with an unreadable date instead of losing the week', () => {
    const broken = { id: 'bad', summary: 'Smith MARINER - Fowler', start: { dateTime: 'not a date' }, end: {} }
    const good = ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { colorId: COLOR.Grape })
    const plan = build([broken, good])
    expect(plan.days[0].casesByHospital[0].cases.map(c => c.patient)).toEqual(['Jackson'])
  })

  it('leaves the system alone when the title names no operation', () => {
    const plan = build([ev('c1', 'Vanderheim MARINER + E4 CAGES - Gupta', '24', '09:00', '10:00',
      { colorId: COLOR.Basil })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.operation).toBeUndefined()
    expect(c.system).toBe('MARINER + E4 CAGES')
  })

  it('accepts an explicit label anywhere in the notes', () => {
    const plan = build([ev('c1', 'Gill STRYKER - Fowler', '24', '10:00', '11:00',
      { colorId: COLOR.Grape, description: 'Kit: PSI\nProcedure: L4-L5 PLIF' })])
    expect(plan.days[0].casesByHospital[0].cases[0].operation).toBe('L4-L5 PLIF')
  })

  it('leaves it unset rather than guessing from an unrelated note', () => {
    const plan = build([ev('c1', 'Gill STRYKER - Fowler', '24', '10:00', '11:00',
      { colorId: COLOR.Grape, description: 'Call Erin before the list starts' })])
    expect(plan.days[0].casesByHospital[0].cases[0].operation).toBeUndefined()
  })

  it('never lets an identifier through the notes', () => {
    const plan = build([ev('c1', 'Gill STRYKER - Fowler', '24', '10:00', '11:00',
      { colorId: COLOR.Grape, description: 'UR 4457821 DOB 14/03/1958 C5/6 ACDF' })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.operation).toContain('C5/6 ACDF')
    expect(JSON.stringify(c)).not.toMatch(/4457821|1958/)
  })
})

describe('a colour-attributed case reaches the plan', () => {
  const COLOUR_ONLY = { colorId: COLOR.Flamingo, location: 'RHH' }

  it('counts a booking whose surgeon comes only from its colour', () => {
    const plan = build([ev('k', 'Kennedy REFORM', '25', '10:00', '11:00', COLOUR_ONLY)])
    const cases = plan.days[1].casesByHospital.flatMap(g => g.cases)
    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({ patient: 'Kennedy', surgeon: 'JPW' })
    expect(plan.days[1].caseCountLine).toBe('1 case — 1 RHH')
    expect(plan.surgeons).toEqual(['JPW'])
    // And it is no longer sitting in the needs-attention list.
    expect(plan.days[1].needsAttention).toHaveLength(0)
  })

  it('says on the case that the surgeon came from the colour', () => {
    const plan = build([ev('k', 'Kennedy REFORM', '25', '10:00', '11:00', COLOUR_ONLY)])
    const note = plan.days[1].casesByHospital[0].cases[0].notes.find(n => /calendar colour/.test(n.text))
    expect(note).toBeTruthy()
    expect(note.kind).toBe('info')   // information, not a fault
  })


  it('does not turn a Graphite on-call entry into a Dubey case', () => {
    const plan = build([ev('o', 'Brent on call', '28', '17:00', '18:00', { colorId: COLOR.Graphite })])
    expect(plan.surgeons).toEqual([])
    expect(plan.days[4].casesByHospital).toHaveLength(0)
    expect(plan.days[4].flags.some(f => /on call/i.test(f.text))).toBe(true)
  })
})
