import { describe, it, expect } from 'vitest'
import { stagesOf } from './stages.js'

describe('two-stage cases', () => {
  it('reads the stage from the operation and the other from the notes', () => {
    const s = stagesOf({
      operation: 'Stage 2: L5/S1 MIS Pedicle Screw Fixation',
      notes: [{ text: 'LHC ALIF Stage 1 then Mariner back up stage 2' }]
    })
    expect(s).toEqual([
      { n: 1, text: 'ALIF', ours: false, by: 'Life Healthcare' },
      { n: 2, text: 'L5/S1 MIS Pedicle Screw Fixation', ours: true, by: '' }
    ])
  })
  it('reads labelled stage lines', () => {
    const s = stagesOf({
      operation: 'Stage 1: L5/S1 ALIF (Life Healthcare - not needed) Stage 2: L5/S1 MIS pedicle screws',
    })
    expect(s.map(x => [x.n, x.ours, x.by])).toEqual([[1, false, 'Life Healthcare'], [2, true, '']])
    expect(s[0].text).toBe('L5/S1 ALIF')
  })
  it('both stages ours when nobody else is named', () => {
    const s = stagesOf({ notes: 'Stage 1: T10-L2 PSF; Stage 2: L3/4 XLIF' })
    expect(s.every(x => x.ours)).toBe(true)
  })
  it('is null for an ordinary case', () => {
    expect(stagesOf({ operation: 'L4/5 PLIF', notes: [{ text: 'first on the list' }] })).toBeNull()
    expect(stagesOf({ operation: 'C5/6 ACDF', notes: 'staged with the anaesthetist' })).toBeNull()
  })
})
