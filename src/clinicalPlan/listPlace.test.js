import { describe, it, expect } from 'vitest'
import {
  ordinal, formatListPlace, parseListPlace, cleanListPlace, describeListPlace, bySession,
  withListPlace
} from './listPlace.js'

// The running order the hospital reads out is the whole theatre list, not our
// part of it. Thompson is second up on JPW's Thursday list, behind a PLIF using
// KT Medical kit that we are not at — so nobody drives in for eight o'clock.
// That is the fact these hold, and moving our own cases past each other could
// never say it, because Thompson is the only case of ours there that day.

describe('saying which number we are', () => {
  it('counts the way the team says it', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
  })

  it('handles the teens, which break the pattern', () => {
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
    expect(ordinal(21)).toBe('21st')
  })

  it('says nothing for a number that is not one', () => {
    expect(ordinal(0)).toBe('')
    expect(ordinal(-1)).toBe('')
    expect(ordinal('two')).toBe('')
  })
})

describe('the line kept in the booking', () => {
  it('writes the whole fact', () => {
    expect(formatListPlace({
      position: 2, session: 'afternoon', from: '1pm',
      ahead: 'after a PLIF — KT Medical, not ours'
    })).toBe('2nd · afternoon · from 1pm · after a PLIF — KT Medical, not ours')
  })

  it('writes only what is known', () => {
    expect(formatListPlace({ position: 1, session: 'afternoon' })).toBe('1st · afternoon')
    expect(formatListPlace({ session: 'afternoon' })).toBe('afternoon')
  })

  it('writes nothing when nothing is known', () => {
    expect(formatListPlace(null)).toBe('')
    expect(formatListPlace({ position: null, session: null, from: '', ahead: '' })).toBe('')
  })

  it('reads back what it wrote', () => {
    const place = {
      position: 2, session: 'afternoon', from: '1pm', ahead: 'after a PLIF'
    }
    expect(parseListPlace(formatListPlace(place))).toEqual(place)
  })
})

describe('reading a line somebody typed by hand', () => {
  // Half the team works in Google Calendar rather than the app, and a line they
  // edited there should not be lost for using a comma.
  it('takes commas as well as the separator it writes', () => {
    expect(parseListPlace('2nd, afternoon')).toMatchObject({ position: 2, session: 'afternoon' })
  })

  it('takes a bare number', () => {
    expect(parseListPlace('2 · pm')).toMatchObject({ position: 2, session: 'afternoon' })
  })

  it('takes the short forms of a session', () => {
    expect(parseListPlace('AM')).toMatchObject({ session: 'morning' })
    expect(parseListPlace('PM')).toMatchObject({ session: 'afternoon' })
    expect(parseListPlace('afternoon list')).toMatchObject({ session: 'afternoon' })
  })

  it('takes the ways a start gets written', () => {
    expect(parseListPlace('at 1pm')).toMatchObject({ from: '1pm' })
    expect(parseListPlace('approx 1pm')).toMatchObject({ from: '1pm' })
    expect(parseListPlace('around 0730')).toMatchObject({ from: '0730' })
  })

  it('keeps words it cannot place rather than dropping them', () => {
    // The parser's habit elsewhere is to drop what it cannot read, which is
    // right for noise. Here the words are the explanation for the wait.
    expect(parseListPlace('2nd · after a craniotomy')).toEqual({
      position: 2, session: null, from: '', ahead: 'after a craniotomy'
    })
  })

  it('is nothing when the line is empty', () => {
    expect(parseListPlace('')).toBe(null)
    expect(parseListPlace(null)).toBe(null)
  })
})

describe('what comes off the form', () => {
  it('keeps a sensible place', () => {
    expect(cleanListPlace({ position: '2', session: 'afternoon', from: '1pm', ahead: 'x' }))
      .toEqual({ position: 2, session: 'afternoon', from: '1pm', ahead: 'x' })
  })

  it('drops a position that is not one rather than correcting it', () => {
    // A running order the app invented is worse than a blank one: nobody would
    // know to check it.
    expect(cleanListPlace({ position: 0, session: 'afternoon' }))
      .toMatchObject({ position: null, session: 'afternoon' })
    expect(cleanListPlace({ position: 99, session: 'afternoon' }))
      .toMatchObject({ position: null })
  })

  it('drops a session nobody offers', () => {
    expect(cleanListPlace({ position: 1, session: 'evening' })).toMatchObject({ session: null })
  })

  it('is nothing when the form was left blank', () => {
    expect(cleanListPlace({})).toBe(null)
    expect(cleanListPlace({ position: '', session: '', from: '', ahead: '' })).toBe(null)
  })
})

describe('what the card says', () => {
  it('leads with the number, because that is what sets the alarm', () => {
    expect(describeListPlace({ position: 2, session: 'afternoon', from: '1pm' }))
      .toEqual({ headline: '2nd on the list · PM · from 1pm', ahead: '' })
  })

  it('keeps the explanation on its own line', () => {
    expect(describeListPlace({ position: 2, ahead: 'after a PLIF — KT Medical, not ours' }))
      .toEqual({ headline: '2nd on the list', ahead: 'after a PLIF — KT Medical, not ours' })
  })

  it('says an afternoon list even when the number is not known yet', () => {
    // Barr is first up but on the afternoon list. Knowing only that the morning
    // is free is most of the value.
    expect(describeListPlace({ session: 'afternoon' })).toEqual({ headline: 'PM', ahead: '' })
  })

  it('says nothing when nobody has rung', () => {
    expect(describeListPlace(null)).toBe(null)
  })
})

describe('the order the lists run in', () => {
  const kase = (id, listPlace) => ({ id, listPlace })

  it('puts the morning list before the afternoon one', () => {
    const order = bySession([
      kase('pm', { session: 'afternoon', position: 1 }),
      kase('am', { session: 'morning', position: 1 })
    ])
    expect(order.map(c => c.id)).toEqual(['am', 'pm'])
  })

  it('orders by position within a session', () => {
    const order = bySession([
      kase('third', { session: 'morning', position: 3 }),
      kase('first', { session: 'morning', position: 1 })
    ])
    expect(order.map(c => c.id)).toEqual(['first', 'third'])
  })

  it('puts a case nobody has rung about behind the ones they have', () => {
    // A known place is worth more than an assumed one. The unplaced case is not
    // being called last — it is being left until somebody knows, which is what
    // the blank on its card says.
    const order = bySession([kase('unknown', null), kase('known', { position: 2 })])
    expect(order.map(c => c.id)).toEqual(['known', 'unknown'])
  })

  it('keeps unplaced cases in the order they were already in', () => {
    const order = bySession([kase('a', null), kase('b', { position: 1 }), kase('c', null)])
    expect(order.map(c => c.id)).toEqual(['b', 'a', 'c'])
  })

  it('does not let an unplaced case jump an afternoon one it might follow', () => {
    // Nothing known defaults to the morning, which is where a list starts.
    const order = bySession([kase('pm', { session: 'afternoon', position: 1 }), kase('none', null)])
    expect(order.map(c => c.id)).toEqual(['none', 'pm'])
  })

  it('is stable when nothing is known at all', () => {
    const order = bySession([kase('a', null), kase('b', null), kase('c', null)])
    expect(order.map(c => c.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('putting the line in a booking', () => {
  const BOOKING = 'Surg: JPW\nPt: Thompson\nHosp: RHH\nKit: Diplomat (Consignment)'

  it('appends it, leaving the fields the team typed where they are', () => {
    expect(withListPlace(BOOKING, { position: 2, session: 'afternoon' }))
      .toBe(`${BOOKING}\nList: 2nd · afternoon`)
  })

  it('replaces the line rather than stacking another one', () => {
    const once = withListPlace(BOOKING, { position: 2 })
    const twice = withListPlace(once, { position: 3 })
    expect(twice).toBe(`${BOOKING}\nList: 3rd`)
    expect(twice.match(/^List:/gm)).toHaveLength(1)
  })

  it('takes it out again when the order was given wrongly', () => {
    const once = withListPlace(BOOKING, { position: 2 })
    expect(withListPlace(once, null)).toBe(BOOKING)
  })

  it('survives a round trip through the reader', () => {
    const place = { position: 2, session: 'afternoon', from: '1pm', ahead: 'after a PLIF' }
    const written = withListPlace(BOOKING, place)
    const line = /^List:\s*(.*)$/m.exec(written)[1]
    expect(parseListPlace(line)).toEqual(place)
  })

  it('handles a booking with no notes at all', () => {
    expect(withListPlace('', { position: 1 })).toBe('List: 1st')
    expect(withListPlace('', null)).toBe('')
  })
})

describe('the words somebody chose', () => {
  it('keeps an explanation containing a dash whole', () => {
    // "after a PLIF — KT Medical, not ours" is one explanation. Breaking it at
    // the dash rewrote what the team had written, which is not a thing to do to
    // somebody's note.
    const place = parseListPlace('2nd · afternoon · from 1pm · after a PLIF — KT Medical, not ours')
    expect(place).toEqual({
      position: 2, session: 'afternoon', from: '1pm',
      ahead: 'after a PLIF — KT Medical, not ours'
    })
  })

  it('round-trips that explanation through the booking', () => {
    const place = {
      position: 2, session: 'afternoon', from: '1pm',
      ahead: 'after a PLIF — KT Medical, not ours'
    }
    const written = withListPlace('Surg: JPW\nPt: Thompson', place)
    expect(parseListPlace(/^List:\s*(.*)$/m.exec(written)[1])).toEqual(place)
  })
})
