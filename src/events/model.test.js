import { describe, it, expect } from 'vitest'
import {
  cleanForm, cleanAnswers, summarise, parseVcf, matchPhoneContacts, parseContactList,
  normaliseMobile, showMobile, icsFor, defaultForm, groupFrom
} from './model.js'

// Invented people only.

describe('reply forms', () => {
  it('gives each kind of event a sensible start', () => {
    expect(defaultForm('inservice').map(q => q.id)).toContain('coffee')
    expect(defaultForm('dinner').map(q => q.id)).toContain('plus')
  })
  it('keeps only known shapes and drops a pick-one with no choices to typed', () => {
    const f = cleanForm([{ id: 'a', label: 'Q', type: 'weird' }, { id: 'b', label: 'Pick', type: 'one', options: [] }])
    expect(f.map(q => q.type)).toEqual(['text', 'text'])
  })
  it('keeps a coffee note with its choice', () => {
    const form = [{ id: 'coffee', label: 'Coffee', type: 'one', options: ['Latte'], note: true }]
    expect(cleanAnswers(form, { coffee: { pick: 'Latte', note: 'large, oat' } })).toEqual({ coffee: { pick: 'Latte', note: 'large, oat' } })
    expect(cleanAnswers(form, { coffee: 'Mocha' })).toEqual({})
  })
})

describe('the counts', () => {
  it('counts a partner as a seat and tallies the choices of those coming', () => {
    const event = {
      capacity: 10,
      form: [{ id: 'main', label: 'Main', type: 'one', options: ['Beef', 'Fish'] }, { id: 'plus', label: 'Partner', type: 'plus' }],
      guests: [
        { name: 'A', group: 'Surgeon', status: 'yes', answers: { main: 'Fish', plus: { coming: true, name: 'P' } } },
        { name: 'B', group: 'Rep/Partner', status: 'yes', answers: { main: 'Beef' } },
        { name: 'C', status: 'no', answers: { main: 'Beef' } },
        { name: 'D', status: 'none' }
      ]
    }
    const s = summarise(event)
    expect(s).toMatchObject({ yes: 2, no: 1, none: 1, seats: 3, left: 7, hcp: 1 })
    expect(s.tallies[0].counts).toEqual({ Beef: 1, Fish: 1 })
  })
})

describe('phone contacts', () => {
  const vcf = [
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Dr Ann Surgeon', 'ORG:RHH;', 'item1.TEL;type=CELL:0400 000 001', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Babysitter Bob', 'TEL:0400 999 999', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:Ben Somebody', 'EMAIL;type=WORK:ben@hosp.example', 'TEL:0400 000 002', 'END:VCARD'
  ].join('\r\n')
  it('reads a .vcf', () => {
    const cards = parseVcf(vcf)
    expect(cards.map(c => c.name)).toEqual(['Dr Ann Surgeon', 'Babysitter Bob', 'Ben Somebody'])
    expect(cards[0].org).toBe('RHH')
  })
  it('only fills mobiles for people already in the list, by email then name — never adds', () => {
    const contacts = [
      { id: '1', name: 'Ann Surgeon', email: 'ann@hosp.example' },
      { id: '2', name: 'Dr Ben Registrar', email: 'ben@hosp.example' },
      { id: '3', name: 'Cat Nurse', email: 'cat@hosp.example', mobile: '+61400000003' }
    ]
    const { updates, unmatched } = matchPhoneContacts(contacts, parseVcf(vcf))
    expect(updates).toEqual([
      { id: '1', mobile: '+61400000001', from: 'phone' },
      { id: '2', mobile: '+61400000002', from: 'phone' }
    ])
    expect(unmatched).toBe(1)
  })
})

describe('lists', () => {
  it('reads a spreadsheet with a Keep? column and skips the No rows', () => {
    const csv = 'Keep?,Group,name,org,title,email,mobile\n,Surgeon,Dr Ann,RHH,,ann@x.example,0400 000 001\nNo,Other,Mum,,,,0400 000 009\n'
    const rows = parseContactList(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Dr Ann', group: 'Surgeon', email: 'ann@x.example', mobile: '+61400000001' })
  })
  it('reads the email sweep JSON', () => {
    const rows = parseContactList(JSON.stringify([{ name: 'Tess', email: 't@x.example', group: 'Unknown', title: 'ANUM Neuro', phones: ['0400 000 004'] }]))
    expect(rows[0]).toMatchObject({ group: 'Theatre/Nursing', mobile: '+61400000004' })
  })
  it('turns a typed role into a group', () => {
    expect(groupFrom('Neurosurgical Registrar')).toBe('Registrar/Fellow')
    expect(groupFrom('Consultant Orthopaedic Surgeon')).toBe('Surgeon')
  })
})

describe('little things', () => {
  it('writes Australian mobiles one way', () => {
    expect(normaliseMobile('0412 345 678')).toBe('+61412345678')
    expect(normaliseMobile('+61 412 345 678')).toBe('+61412345678')
    expect(showMobile('+61412345678')).toBe('0412 345 678')
  })
  it('makes a calendar file', () => {
    const ics = icsFor({ id: 'e1', title: 'Dinner, with friends', start: '2026-12-04T08:00:00.000Z', venue: 'Somewhere' }, 'https://x/e/t')
    expect(ics).toMatch(/DTSTART:20261204T080000Z/)
    expect(ics).toMatch(/SUMMARY:Dinner\\, with friends/)
  })
})
