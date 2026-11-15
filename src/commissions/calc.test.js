import { describe, it, expect } from 'vitest'
import { commissionsFor, monthIn, salesIn } from './calc.js'
import { DEFAULT_RULES } from './rules.js'
import { paymentDateFor, calcDateFor, nextSalesMonth } from './schedule.js'

// September 2026 as Xero has it (descriptions as on the invoices; amounts net).
const inv = (id, number, contact, date, reference, lines) => ({ id, number, contact, date, reference, status: 'AUTHORISED', lines })
const l = (description, amount, itemName) => ({ description, amount, itemName })
const SEP = [
  inv('a', 'INV-2015', 'Signus Australia Pty Ltd', '2026-10-19', 'SEP 2026 Sales Comms', [l('Commission on SEPTEMBER 2026 Sales of $177,678.00 @ 30%', 53303.4)]),
  inv('b', 'INV-2007', 'Device Technologies Australia Pty. Ltd.', '2026-10-12', 'SEP 2026 Comms', [
    l('Commission on September 2026 MARINER, NORTHSTAR, REEF TO Sales of $51,437.00 @ 25%', 12479.35),
    l('Commission on September 2026 SHORELINE, ICOTEC Sales of $20,154.00 @ 22.5%', 4534.65),
    l('Commission on September 2026 BOOST Allograft Product Sales of $110,550.00 @ 12%', 13266)]),
  inv('c', 'INV-2012', 'E4 Surgical', '2026-10-15', 'SEP 2026 Sales Comms', [l('Commission on September 2026 Sales of $164,255.00 @ 30%', 49276.5)]),
  inv('d', 'INV-2004', 'Evomed', '2026-10-07', 'Clinical Support September 2026', [l('Clinical Support for September 2026 (15.4% commissions on total IMPLANT and CONSUMABLE sales of $101,511.50)', 15632.77)]),
  inv('e', 'INV-2001', 'KT Medical Pty Ltd', '2026-10-02', 'SEP 26 Implant Sales Comms', [l('Clinical Case Support Fee for September 2026, on sales of $34,911.70 @ 25%', 8727.93)]),
  inv('f', 'INV-2011', 'KT Medical Pty Ltd', '2026-10-15', 'SEP 2026 DTBV Sales Comms', [l('Commission on September 2026 Total Sales of $4,492.00 @ 20%', 898.4)]),
  inv('g', 'INV-2018', 'Novus Surgical', '2026-10-23', 'SEP 2026 Sales Commissions', [l('Commission on sales of Xperience in Tasmania for September 2026. [Total sales: $6,300.00 (ex GST) @ 20%]', 1260)]),
  // Lateral Medical kits sold to Calvary Lenah Valley in September
  inv('h', 'INV-1990', 'Calvary Lenah Valley Hospital', '2026-09-10', 'LVH1', [l('Jackson Spinal Kit (Box of 6)', 5100, 'Jackson Spinal Kit (Box of 6)'), l('Frazier Suction', 141, 'Frazier')]),
  inv('i', 'INV-1991', 'Calvary Lenah Valley Hospital', '2026-09-20', 'LVH2', [l('Shoulder Stabilisation Kit (Box of 6)', 1200, 'Shoulder Stabilisation Kit (Box of 6)'), l('Beach Chair Face Mask (Box of 20)', 600, 'Beach Chair Face Mask (Box of 20)')]),
  // an October LV invoice is not September's
  inv('j', 'INV-2021', 'Calvary Lenah Valley Hospital', '2026-10-26', 'LVH3', [l('Jackson Spinal Kit (Box of 6)', 1530, 'Jackson Spinal Kit (Box of 6)')]),
  // an August correction raised in October
  inv('k', 'INV-2019', 'Device Technologies Australia Pty. Ltd.', '2026-10-23', 'Additional AUG 2026 Comms', [l('Commission on August 2026 BOOST Allograft Product Sales of $3,800 @ 12%', 456)])
]

describe('commissions — September 2026 reproduced (Brent\'s workbook)', () => {
  const out = commissionsFor({ salesMonth: '2026-09', invoices: SEP, rules: DEFAULT_RULES, counted: new Set(['k:0']) })
  const mat = out.people.find(p => p.name === 'Mat Usher')
  it('pays Mat $12,546.44 across the four pay items', () => {
    expect(mat.byPayItem).toEqual({ 'Commissions Spine': 2137.29, 'Commissions Evomed': 10151.15, 'Commission Novus Surgical': 189, 'Commissions Lateral Medical': 69 })
    expect(mat.total).toBe(12546.44)
  })
  it('pays Toni 15% of the Novus commission', () => {
    expect(out.people.find(p => p.name === 'Toni Hoppitt').total).toBe(189)
  })
  it('says what was not invoiced', () => {
    expect(out.missing).toEqual(['Nuvasive'])
  })
  it('picks up a late correction for an earlier month once', () => {
    const fresh = commissionsFor({ salesMonth: '2026-09', invoices: SEP, rules: DEFAULT_RULES })
    const boost = fresh.people.find(p => p.name === 'Mat Usher').lines.find(x => x.row === 'boost')
    expect(boost.adjustments).toEqual(['INV-2019 (2026-08)'])
    expect(mat.lines.find(x => x.row === 'boost').adjustments).toEqual([])
  })
  it('reads months and sales figures off the lines', () => {
    expect(monthIn('SEP 26 Implant Sales Comms')).toBe('2026-09')
    expect(salesIn('Commission on sales of Xperience in Tasmania for September 2026. [Total sales: $6,300.00')).toBe(6300)
  })
})

describe('when commissions are paid', () => {
  it('two months on, on the 1st or the next business day', () => {
    expect(paymentDateFor('2026-07')).toBe('2026-09-01')
    expect(paymentDateFor('2026-09')).toBe('2026-11-02') // 1 Nov 2026 is a Sunday
    expect(paymentDateFor('2026-10')).toBe('2026-12-01')
    expect(paymentDateFor('2026-11')).toBe('2027-01-04') // New Year's Day Fri, then the weekend
  })
  it('worked out three business days before', () => {
    expect(calcDateFor('2026-10')).toBe('2026-11-26')
    expect(nextSalesMonth('2026-11-15')).toBe('2026-10')
  })
})

describe('a month with only a late correction from a distributor (October 2026)', () => {
  it('still says that distributor has not invoiced the month', () => {
    const out = commissionsFor({ salesMonth: '2026-10', rules: DEFAULT_RULES, invoices: [
      inv('n', 'INV-2033', 'Device Technologies Australia Pty. Ltd.', '2026-11-05', 'SEP 2026 Northstar Rate Adjustment', [l('Commission on September 2026 NORTHSTAR Sales of $15,196.00 @ 25% (less commission already received at 22.5% on INV-2007)', 379.9)])
    ] })
    expect(out.missing).toContain('Device Technologies Implants (Mariner, Northstar, Reef TO)')
    const line = out.people[0].lines.find(x => x.row === 'device_mariner')
    expect(line.invoices).toEqual([])
    expect(line.adjustments).toEqual(['INV-2033 (2026-09)'])
    expect(line.amount).toBe(5.7)
  })
})
