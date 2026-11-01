import { describe, it, expect } from 'vitest'
import { parseTheatreList } from './parseTheatreList.js'
import { brainlabFromKit } from './attendance.js'
import { findNavigation } from './systems.js'

// ─── Toby's RHH lists: Brainlab, No F2F, and a surname with a comma ─────────
// Laid out the way his "Cases for…" emails are, with invented patients.

const row = (...cells) => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`
const HTML = `<table>
${row('Wednesday<br>4th November 2026')}
${row('Neurosurgery', 'DUBEY', 'Theatre Number 11', 'List duration 08:00am to 5:00pm - All Day List')}
${row('BLabs no F2F required', 'TESTA Jane', 'Right frontal craniotomy')}
${row('Thursday<br>5th November 2026')}
${row('Neurosurgery', 'ATALLAH', 'Theatre Number 15', 'List duration 13:30pm to 17:00pm - PM List')}
${row('', 'ROSSA, Mary', 'C5/6 ACDF +/- C6/7')}
${row('Mariner + E4', 'BIANCA Lou', 'L4/5 PLIF')}
</table>`

describe('a Brainlab no-F2F case on the list', () => {
  const cases = parseTheatreList({ html: HTML })

  it('is read as Brainlab, nobody needed', () => {
    const c = cases.find(x => x.patient === 'Testa')
    expect(c).toMatchObject({ date: '2026-11-04', surgeon: 'Dubey', kit: 'BRAINLAB', attendance: 'No F2F' })
    expect(c.note).toBe('No F2F required')
  })

  it('reads a surname written with a comma after it', () => {
    expect(cases.find(x => x.patient === 'Rossa')).toMatchObject({ surgeon: 'Atallah', date: '2026-11-05' })
  })

  it('leaves an ordinary case alone', () => {
    const c = cases.find(x => x.patient === 'Bianca')
    expect(c.kit).toBe('Mariner + E4')
    expect(c.attendance).toBeUndefined()
  })
})

describe('reading a kit cell', () => {
  it.each([
    ['BLabs no F2F required', 'BRAINLAB', 'No F2F'],
    ['Brainlab', 'BRAINLAB', null],
    ['Mariner + BLabs', 'Mariner + BRAINLAB', null],
    ['Lonestar', 'Lonestar', null]
  ])('%s', (kit, out, attendance) => {
    expect(brainlabFromKit(kit)).toEqual({ kit: out, attendance })
  })
})

describe('AIRO and Curve', () => {
  it('an AIRO case is always AIRO + Curve', () => {
    expect(findNavigation('L4/5 PLIF, AIRO spin')).toEqual(['AIRO', 'Curve'])
  })
  it('the Curve can be used on its own', () => {
    expect(findNavigation('Curve navigated craniotomy')).toEqual(['Curve'])
  })
})
