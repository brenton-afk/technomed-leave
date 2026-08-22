import { describe, it, expect, vi } from 'vitest'
import { buildWeekPlan } from './buildWeekPlan.js'
import { weekWindowFor } from './week.js'
import { checkEventColour, summariseColourFindings, colourNameFor } from './colours.js'
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

describe('colour-coding check (§5.4)', () => {
  it('detects a case with no colour set', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { location: 'RHH' })])
    const finding = plan.colourCodingFindings[0]
    expect(finding.kind).toBe('missingColour')
    expect(finding.expected).toBe('Grape')
    // Inline on the case, and in the roll-up.
    expect(plan.days[0].casesByHospital[0].cases[0].notes[0].text)
      .toBe('■ COLOUR-CODING: no calendar colour set — should be Grape')
    expect(plan.keyFlags.find(f => f.label === 'Colour-coding check').text).toMatch(/should be Grape/)
  })

  it('detects a case coloured as the wrong surgeon', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00', { colorId: COLOR.Basil })])
    const finding = plan.colourCodingFindings[0]
    expect(finding.kind).toBe('wrongColour')
    expect(finding.actual).toBe('Basil')
    expect(finding.expected).toBe('Grape')
  })

  it('notes a non-surgical entry wearing a surgeon colour without relabelling it', () => {
    const plan = build([ev('x1', 'Vendor visit — Andrea Weller', '28', '09:00', '10:00', { colorId: COLOR.Grape })])
    const finding = plan.colourCodingFindings[0]
    expect(finding.kind).toBe('surgeonColourOnNonCase')
    expect(finding.surgeon).toBe('Fowler')
    // Not turned into a Fowler case.
    expect(plan.surgeons).toEqual([])
    expect(plan.days[4].casesByHospital).toHaveLength(0)
  })

  it('treats a Graphite on-call entry as a probable convention, not an error', () => {
    const plan = build([ev('x1', 'Brent on call', '28', '17:00', '18:00', { colorId: COLOR.Graphite })])
    const finding = plan.colourCodingFindings[0]
    expect(finding.kind).toBe('staffingConvention')
    expect(finding.severity).toBe('info')
    expect(finding.message).toMatch(/established/)
    // Dubey has no case this week, so that is called out.
    expect(finding.message).toMatch(/no case this window/)
  })

  it('says so when a Graphite entry coincides with a real Dubey case', () => {
    const finding = checkEventColour({
      id: 'x', title: 'Brent on call', date: '2026-08-28', colorId: 8,
      surgeon: null, isCase: false, surgeonsWithCases: ['Dubey']
    })
    expect(finding.kind).toBe('staffingConvention')
    expect(finding.message).not.toMatch(/no case this window/)
  })

  it('passes a correctly coloured case silently', () => {
    const plan = build([ev('c1', 'Gill STRYKER CCI - Fowler', '24', '11:00', '12:00', { colorId: COLOR.Grape })])
    expect(plan.colourCodingFindings).toHaveLength(0)
    expect(plan.days[0].casesByHospital[0].cases[0].notes).toEqual([])
    expect(plan.keyFlags.find(f => f.label === 'Colour-coding check').text).toMatch(/All cases correctly coded/)
  })

  it('always reports the check, even in a clean week', () => {
    expect(build([]).keyFlags.some(f => f.label === 'Colour-coding check')).toBe(true)
  })

  it('maps Google colorIds to the names the guide uses', () => {
    expect(colourNameFor(3)).toBe('Grape')
    expect(colourNameFor(8)).toBe('Graphite')
    expect(colourNameFor(null)).toBeNull()
  })

  it('summarises what is wrong and confirms what is right', () => {
    const cases = [{ id: 'a', patient: 'Gill', surgeon: 'Fowler', calendarColorName: 'Grape' }]
    const findings = [{ kind: 'missingColour', severity: 'error', eventId: 'b', title: 'Jackson/Fowler', date: '2026-08-24', expected: 'Grape' }]
    const text = summariseColourFindings(findings, cases)
    expect(text).toMatch(/One booking is coded incorrectly/)
    expect(text).toMatch(/Correctly coded: Gill\/Fowler Grape/)
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

  it('includes only the labels relevant to the week', () => {
    const labels = build([]).keyFlags.map(f => f.label)
    expect(labels).toEqual(['Colour-coding check'])
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

  it('mentions missing colours in the notes', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00')])
    expect(plan.notes).toMatch(/missing their calendar colour/)
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
  it('reads the clinical procedure and keeps the system alongside it', () => {
    const plan = build([ev('c1', 'Jackson MARINER - Fowler', '24', '10:00', '11:00',
      { colorId: COLOR.Grape, description: 'C5/6 ACDF\nKit: Mariner set' })])
    const c = plan.days[0].casesByHospital[0].cases[0]
    expect(c.operation).toBe('C5/6 ACDF')
    expect(c.procedure).toBe('MARINER')   // the system is not overwritten
    expect(c.kit).toBe('Mariner set')
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
