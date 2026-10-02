import { describe, it, expect } from 'vitest'
import { systemsInKit } from './systems.js'

describe('Reform, however it is written on a booking', () => {
  // Singh's booking said "Reform" and the app answered that Reform was not a
  // listed system — about a kit sitting on the shelf at RHH.
  //
  // E4 Reform Posterior Cervical Lateral Mass Screws is the full name and
  // nobody writes it. On a booking it is "Reform", "Reform Cervical" or
  // "E4 Reform", and all three are the one consignment kit at RHH. The
  // detector called it "Reform"; the inventory calls it "Reform Cervical";
  // nothing joined them up. Exactly the fault that hid Global BMD PLIF behind
  // "E4 Global PLIF" — two names for one thing, and the detector using the one
  // the inventory has never heard of.
  for (const written of [
    'Reform', 'REFORM', 'reform', 'Reform Cervical', 'Reform Cerv',
    'E4 Reform', 'E4 Reform Cervical', 'Reform (Consignment)',
    'Reform cervical set', 'E4 REFORM'
  ]) {
    it(`"${written}" is the Reform Cervical kit`, () => {
      expect(systemsInKit(written)).toEqual(['Reform Cervical'])
    })
  }

  it('does not also ask which E4 product it is', () => {
    // "E4 Reform" matched the product and the bare "E4" both, so a line that
    // said precisely which E4 product it was still asked which one it was —
    // next to the right answer.
    expect(systemsInKit('E4 Reform')).not.toContain('E4 Cages')
  })

  it('still treats the lumbar set as its own thing', () => {
    // The one case where the bare word is not the cervical kit, so it is
    // tested first. We do not hold it, and saying so is correct.
    expect(systemsInKit('Reform Lumbar')).toEqual(['Reform Lumbar'])
  })

  it('still asks which product when the booking only says E4', () => {
    // The ambiguity this was always right about. E4 make four things and the
    // wrong tray is a tray nobody can use.
    expect(systemsInKit('E4 Cages')).toEqual(['E4 Cages'])
  })

  it('still reads an E4 cage named alongside pedicle screws', () => {
    expect(systemsInKit('Diplomat and E4 Cages')).toEqual(['Diplomat', 'Global BMD PLIF'])
  })
})
