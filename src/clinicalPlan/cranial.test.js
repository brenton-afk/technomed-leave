import { describe, it, expect } from 'vitest'
import { isCranialCase } from './cranial.js'
import { needsOutrigger, kitWithAutoOutrigger } from './outrigger.js'
import { suggestSystems } from './systemSuggestions.js'
import { assumedKit } from './deduceKit.js'
import { inSituReason } from './priorImplants.js'

// Brent, 27 Nov 2026: "It must not mix in spine implants into cranial
// bookings — that's a bad mistake."
const CRANIAL = [
  'Sterotactic redo left sided craniotomy and excision open biopsy of enhancing lesion',
  'Stereotactic Left Occipital craniotomy and resection of extraxial lesion',
  'Insertion of VP shunt',
  'Revision of VP shunt',
  'Redo burr holes for chronic subdural',
  'Endoscopic transsphenoidal pituitary tumour resection',
  'Stereotactic needle biopsy',
  'Craniotomy and clipping of aneurysm'
]
const SPINE = [
  'Redo posterior fusion L4-S1',
  'Revision L4/5 PLIF',
  'ACDF C5/6',
  'Extension of L3-5 fixation to T12',
  'Posterior fossa decompression and C1 laminectomy',
  'extending the construct cranially',
  'Cranial extension of fusion to T10'
]

describe('isCranialCase', () => {
  it.each(CRANIAL)('cranial: %s', op => expect(isCranialCase(op)).toBe(true))
  it.each(SPINE)('not cranial: %s', op => expect(isCranialCase(op)).toBe(false))
})

describe('no automatic spinal kit on a cranial booking', () => {
  it.each(CRANIAL)('%s', op => {
    expect(needsOutrigger({ procedure: op })).toBe(false)
    expect(kitWithAutoOutrigger({ procedure: op, kit: '' })).toBe('')
    const s = suggestSystems({ operation: op, surgeon: 'Fowler', hospital: 'RHH' })
    expect(s.systems).toEqual([])
    expect(s.picks).toEqual([])
    for (const surgeon of ['Fowler', 'Ibbett', 'Thani', 'JPW', 'Atallah']) {
      expect(assumedKit({ surgeon, procedure: op, hospital: 'RHH', kit: '' })).toBeNull()
    }
    expect(inSituReason(op)).toBeNull()
  })

  it('spinal cases still get their rules', () => {
    expect(needsOutrigger({ procedure: 'Redo posterior fusion L4-S1' })).toBe(true)
    expect(inSituReason('Revision L4/5 PLIF')).not.toBeNull()
  })
})
