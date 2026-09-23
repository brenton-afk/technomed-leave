import { describe, it, expect } from 'vitest'
import {
  labelledFieldSpans, setLabelledValue, replaceSurname, parseLabelledDescription
} from './labelledFields.js'

// Editing a booking writes to a calendar several people rely on, so the writer
// only ever touches the field it was asked to touch.
//
// The alternative — rebuild the description from what the portal knows — is
// tempting and wrong. The portal holds a patient's surname and nothing else by
// policy, so regenerating Mitchell's booking would write back "Patient:
// Mitchell" and quietly delete the "(Donna)" somebody recorded on purpose. More
// generally the app has been wrong about what a booking contains several times
// already, and a writer that touches only what it was asked to cannot lose the
// parts it still misunderstands.

// The live 23 September booking, verbatim apart from the names.
const MITCHELL = '\nSurg - Dr Ibbett\nPt - Marsh (Donna)\nDate - 23/09/2026\n'
  + 'Procedure - L5/S1 PLIF\nKit - Diplomat (Consignment) /Cascadia/AIRO\n'
  + 'Hospital - Calvary Lenah Valley'

describe('changing one field', () => {
  it('leaves every other character alone', () => {
    const after = setLabelledValue(MITCHELL, 'kit', 'Diplomat (Consignment)')
    expect(after).toContain('Kit - Diplomat (Consignment)\n')
    expect(after).not.toContain('AIRO')
    // Everything else is byte-identical.
    expect(after.replace(/Kit - .*/, 'X')).toBe(MITCHELL.replace(/Kit - .*/, 'X'))
  })

  it('round-trips through the reader', () => {
    // The point of writing to the labels: the app reads back what it wrote.
    const after = setLabelledValue(MITCHELL, 'procedure', 'L4/5 TLIF')
    expect(parseLabelledDescription(after).procedure).toBe('L4/5 TLIF')
  })

  it('keeps the spacing the team typed', () => {
    // "Surg:  Fowler" staying "Surg:  Fowler" — an edit nobody made showing up
    // in the calendar's revision history is noise at best.
    const after = setLabelledValue('Surg:  Fowler\nPt: Jackson', 'patient', 'Marsh')
    expect(after).toBe('Surg:  Fowler\nPt: Marsh')
  })

  it('adds a field the booking does not have yet', () => {
    expect(setLabelledValue('Surg: Fowler', 'hospital', 'RHH')).toBe('Surg: Fowler\nHospital: RHH')
  })

  it('does not invent a line for an empty value', () => {
    expect(setLabelledValue('Surg: Fowler', 'hospital', '')).toBe('Surg: Fowler')
  })

  it('never breaks the description across lines', () => {
    // A newline pasted into a field would split the booking into two labels.
    const after = setLabelledValue(MITCHELL, 'procedure', 'L4/5 TLIF\nand a second line')
    expect(Object.keys(labelledFieldSpans(after)).sort())
      .toEqual(Object.keys(labelledFieldSpans(MITCHELL)).sort())
  })

  it('handles a booking with no labels at all', () => {
    // A free-text booking. The parser prefers labels, so adding one is how the
    // change takes effect — and the title is left as the team typed it.
    expect(setLabelledValue('', 'surgeon', 'Ibbett')).toBe('Surgeon: Ibbett')
  })
})

describe('the patient', () => {
  it('replaces the surname and keeps what follows', () => {
    // The portal never shows a first name and must not be why one disappears.
    expect(replaceSurname('Mitchell (Donna)', 'Marsh')).toBe('Marsh (Donna)')
  })

  it('copes with nothing following', () => {
    expect(replaceSurname('Mitchell', 'Marsh')).toBe('Marsh')
  })

  it('copes with an empty original', () => {
    expect(replaceSurname('', 'Marsh')).toBe('Marsh')
  })

  it('survives a full edit through the writer', () => {
    const existing = labelledFieldSpans(MITCHELL).patient.value.trim()
    const after = setLabelledValue(MITCHELL, 'patient', replaceSurname(existing, 'Okafor'))
    expect(after).toContain('Pt - Okafor (Donna)')
    expect(parseLabelledDescription(after).patient).toBe('Okafor (Donna)')
  })
})

describe('where the fields are', () => {
  it('finds every label with its offsets', () => {
    const spans = labelledFieldSpans(MITCHELL)
    expect(Object.keys(spans).sort()).toEqual(
      ['date', 'hospital', 'kit', 'patient', 'procedure', 'surgeon'])
    expect(MITCHELL.slice(spans.kit.from, spans.kit.to).trim())
      .toBe('Diplomat (Consignment) /Cascadia/AIRO')
  })

  it('agrees with the reader about every value', () => {
    // Two scans of the same text; if they disagreed, an edit would write to the
    // wrong place.
    const spans = labelledFieldSpans(MITCHELL)
    const read = parseLabelledDescription(MITCHELL)
    for (const [field, value] of Object.entries(read)) {
      expect(spans[field].value.trim(), field).toBe(value)
    }
  })
})
