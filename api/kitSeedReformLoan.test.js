import { describe, it, expect, vi } from 'vitest'
import { REFORM_LOAN_KIT, REFORM_LOAN_TRAYS, reformCaseFrom, runReformLoan } from './_kitSeedReformLoan.js'
import { awayLines, caseFor } from '../src/kit/systems.js'
import { needsAgreement } from '../src/kit/agreements.js'

// Brent, 21 Nov 2026: E4's Reform loan set at Calvary, from E4's loan set
// checklist, so it can be turned around. Invented names, no prices.
describe('E4 Reform loan set at Calvary', () => {
  it('has the eight trays with the totals on E4’s sheets', () => {
    const total = n => REFORM_LOAN_TRAYS.find(t => t.name.includes(n)).lines.reduce((s, l) => s + l.qty, 0)
    expect(REFORM_LOAN_TRAYS).toHaveLength(8)
    expect(total('55.1a')).toBe(23)
    expect(total('55.1b')).toBe(20)
    expect(total('55.2 ')).toBe(136 + 74 + 26)
    expect(total('55.3a')).toBe(12)
    expect(total('55.3b')).toBe(22)
    expect(total('55.3c')).toBe(6)
    expect(total('55.7')).toBe(26)
    expect(total('Posterior Cervical')).toBe(4)
    expect(JSON.stringify(REFORM_LOAN_TRAYS)).not.toMatch(/\$|\bprice\b|\bAUD\b/i)
  })
  it('is a distributor loan set: no agreement, always on the tile, with the case it is held for', () => {
    expect(REFORM_LOAN_KIT).toMatchObject({ kind: 'loan', home: 'CLV', distributor: 'e4', system: 'Reform Cervical' })
    expect(needsAgreement(REFORM_LOAN_KIT)).toBe(false)
    const kit = { ...REFORM_LOAN_KIT, at: 'CLV', heldFor: { surname: 'Testcase', surgeon: 'Gupta', caseDate: '2026-12-04' } }
    expect(awayLines([kit])).toEqual(['E4 loan set at Calvary · for pt Testcase'])
    expect(caseFor(kit.heldFor)).toBe('pt Testcase · Gupta · Fri 4 Dec')
  })
  it('finds the next live Reform case at Calvary on the calendar', () => {
    const read = (title, desc) => ({ patient: title.split(' ')[0], surgeon: /Gupta/.test(title) ? 'Gupta' : 'Peters-Willke', hospital: /Calvary/.test(desc) ? 'CLV' : 'RHH', kit: /Reform/.test(desc) ? 'Reform' : 'Dakota' })
    const ev = (date, summary, description) => ({ start: { date }, summary, description })
    const got = reformCaseFrom([
      ev('2026-11-25', 'Laterone PCF - JPW', 'Hospital: Calvary\nKit: Reform'),
      ev('2026-12-01', 'CANCELLED Other PCF - Gupta', 'Hospital: Calvary\nKit: Reform'),
      ev('2026-12-02', 'Rhhcase PCF - Gupta', 'Hospital: RHH\nKit: Reform'),
      ev('2026-12-04', 'Testcase PCF - Gupta', 'Hospital: Calvary\nKit: Reform')
    ], read, '2026-11-25')
    expect(got).toEqual({ surname: 'Laterone', surgeon: 'Peters-Willke', caseDate: '2026-11-25', then: { surname: 'Testcase', surgeon: 'Gupta', caseDate: '2026-12-04' } })
    const kit = { ...REFORM_LOAN_KIT, at: 'CLV', heldFor: got }
    expect(awayLines([kit])).toEqual(['E4 loan set at Calvary · for pt Laterone, then pt Testcase'])
    expect(caseFor(got)).toBe('pt Laterone · Peters-Willke · Wed 25 Nov, then pt Testcase · Gupta · Fri 4 Dec')
  })
  it('saves the trays with a photo each, once, and records the case', async () => {
    const store = new Map([['kits:defs', JSON.stringify([{ trays: [], ...REFORM_LOAN_KIT }])]])
    const uploads = []
    const deps = {
      redisMod: { redisSetBody: async (k, v) => store.set(k, v) },
      kits: { getDefs: async () => JSON.parse(store.get('kits:defs')), getTrayList: async () => (store.has(`kits:list:${REFORM_LOAN_KIT.id}`) ? JSON.parse(store.get(`kits:list:${REFORM_LOAN_KIT.id}`)) : null), addHistory: vi.fn() },
      upload: async path => { uploads.push(path) },
      photos: { PHOTOS: Object.fromEntries(REFORM_LOAN_TRAYS.map(t => [t.photo, 'aGk='])) },
      nextCase: async () => ({ surname: 'Testcase', surgeon: 'Gupta', caseDate: '2026-12-04' })
    }
    const out = await runReformLoan(deps)
    expect(out.photos).toBe(8)
    expect(uploads.every(p => p.startsWith('/Tray Lists/Tray Photos/Reform E4 loan set/'))).toBe(true)
    const def = JSON.parse(store.get('kits:defs'))[0]
    expect(def.trays).toHaveLength(8)
    expect(def.heldFor.caseDate).toBe('2026-12-04')
    expect(await runReformLoan(deps)).toBeNull()
  })
})
