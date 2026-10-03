import { describe, it, expect } from 'vitest'
import {
  categoriesForStaff, demoCategories, isDemo, CATEGORY_RULES, DEMO_RATE_PREFIX
} from './_payItems.js'

const rate = (id, name, extra = {}) => ({ EarningsRateID: id, Name: name, ...extra })

describe('commission never reaches a timesheet', () => {
  // Commission is worked out once a month by Brent from figures nobody else
  // sees, and staff have no business entering their own. It sits on their Xero
  // pay template because that is where it is paid from — which became a
  // problem the moment entitlements started coming from the template.
  const RATES = [
    rate('r-ord', 'Ordinary Hours'),
    rate('r-comm', 'Commission'),
    rate('r-comm2', 'Sales Commission'),
    rate('r-bonus', 'Annual Bonus')
  ]

  it('leaves it off even when Xero assigns it', () => {
    const cats = categoriesForStaff(RATES, 'mat@technomed.com.au',
      { assignedRateIds: ['r-ord', 'r-comm', 'r-comm2', 'r-bonus'] })
    expect(cats.map(c => c.key)).toEqual(['ordinary'])
  })

  it('leaves it off the fallback list too', () => {
    const cats = categoriesForStaff(RATES, 'mat@technomed.com.au', {})
    expect(cats.some(c => /commission/i.test(c.xeroName || ''))).toBe(false)
  })

  it('does not let it through as an unrecognised rate', () => {
    // The catch-all pass shows rates no rule matches, which is how a
    // commission item would otherwise have appeared — as a box to type in.
    const cats = categoriesForStaff([rate('r-comm', 'Commission')],
      'mat@technomed.com.au', { assignedRateIds: ['r-comm'] })
    expect(cats).toEqual([])
  })

  it('still keeps the ordinary pay items', () => {
    const cats = categoriesForStaff([rate('r-ord', 'Ordinary Hours'), rate('r-ot', 'Overtime')],
      'ben@technomed.com.au', { assignedRateIds: ['r-ord', 'r-ot'] })
    expect(cats.map(c => c.key).sort()).toEqual(['ordinary', 'overtime_1_5'])
  })
})

describe('the demonstration timesheet', () => {
  // Brent's own Xero template has one earnings rate on it, because he does not
  // file a timesheet — so the screen he opens to check shows one column and
  // none of the parts worth checking.
  it('carries every category the app knows how to show', () => {
    expect(demoCategories().map(c => c.key).sort())
      .toEqual(CATEGORY_RULES.map(r => r.key).sort())
  })

  it('stays in step with the real list without anybody maintaining it', () => {
    // Built from CATEGORY_RULES rather than written out, so a category added
    // to the app turns up here on its own.
    expect(demoCategories().length).toBe(CATEGORY_RULES.length)
  })

  it('shows the callout as a counted thing and on-call as hours', () => {
    const by = Object.fromEntries(demoCategories().map(c => [c.key, c]))
    expect(by.call_in.unit).toBe('count')
    expect(by.call_in.hint).toBe('$250 per call in')
    expect(by.on_call.unit).toBe('hours')
    expect(by.on_call.hint).toBe('$4.50 per hour')
  })

  it('is recognisable as made up', () => {
    expect(isDemo(demoCategories())).toBe(true)
    for (const c of demoCategories()) {
      expect(String(c.earningsRateID).startsWith(DEMO_RATE_PREFIX)).toBe(true)
    }
  })

  it('does not mistake a real set for a demonstration one', () => {
    const real = categoriesForStaff([rate('r-ord', 'Ordinary Hours')],
      'ben@technomed.com.au', { assignedRateIds: ['r-ord'] })
    expect(isDemo(real)).toBe(false)
    expect(isDemo([])).toBe(false)
  })

  it('has no commission on it either', () => {
    expect(demoCategories().some(c => /commission/i.test(c.label))).toBe(false)
  })
})
