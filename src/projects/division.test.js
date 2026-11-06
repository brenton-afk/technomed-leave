import { describe, it, expect } from 'vitest'
import { divisionOf, divisionFromText } from './model.js'
import { STAFF } from '../staffConfig.js'

// Brent, 6 Nov 2026: spine tasks were filed under CMF because Mat owns them and
// Mat's division is CMF. "Tasks should be allocated according to product
// groups and references … Mat works across most areas of the business."
const mats = task => ({ task, assignee: 'Mat Usher' })

describe('a task is filed by what it names', () => {
  it('reads spine systems, distributors, surgeons and operations as Spine', () => {
    for (const said of ['Restock the Mariner tray', 'Chase Signus about the loan set',
      'Order Dakota cages for Thani', 'Ask Fowler about the ACDF list', 'Count the Lonestar screws']) {
      expect(divisionFromText(said), said).toBe('Spine')
    }
  })

  it('reads Stryker, KLS and max-fax work as CMF', () => {
    for (const said of ['Stryker PSI plate for Garg', 'Call KLS Martin about the orbital mesh',
      'CMF in-service at RHH', 'Mandible plating demo']) {
      expect(divisionFromText(said), said).toBe('CMF')
    }
  })

  it('reads orthopaedic work as Orthopaedics', () => {
    expect(divisionFromText('Hip arthroplasty trial set for Harvie')).toBe('Orthopaedics')
  })

  it('does not mistake Orthofix for orthopaedics', () => {
    expect(divisionFromText('Orthofix Firebird screws back to KT')).toBe('Spine')
  })

  it('leaves a task naming two areas to its project rather than guessing', () => {
    expect(divisionFromText('Mariner and Stryker trays to the office')).toBe('')
  })
})

describe("Mat's tasks are not CMF just because they are Mat's", () => {
  it('files his spine task under Spine', () => {
    expect(divisionOf(mats('Get the Diplomat kit back from Calvary'), null, STAFF)).toBe('Spine')
  })

  it('files his CMF task under CMF', () => {
    expect(divisionOf(mats('Stryker rep meeting'), null, STAFF)).toBe('CMF')
  })

  it('gives his general task no division rather than CMF', () => {
    expect(divisionOf(mats('Book the team dinner'), null, STAFF)).toBe('')
  })

  it('still lets a project with a division hold a task that names nothing', () => {
    expect(divisionOf(mats('Follow up the quote'), { division: 'CMF' }, STAFF)).toBe('CMF')
  })

  it('lets the product win over the project', () => {
    expect(divisionOf(mats('Mariner tray restock'), { division: 'CMF' }, STAFF)).toBe('Spine')
  })

  it('still files somebody who works in one area by their area', () => {
    expect(divisionOf({ task: 'Tidy the store room', assignee: 'Aimee Vulinovich' }, null, STAFF)).toBe('Spine')
  })
})
