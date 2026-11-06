import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Kit room: moves and the hospital emails ─────────────────────────────────
// "We don't want inaccurate comms going to either team." Fake surnames only.

const store = new Map()
const lists = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
    if (cmd === 'getdel') { const v = store.get(args[0]) ?? null; store.delete(args[0]); return v }
    if (cmd === 'mget') return args.map(k => store.get(k) ?? null)
    if (cmd === 'set') { store.set(args[0], args[1]); return 'OK' }
    if (cmd === 'del') { store.delete(args[0]); return 1 }
    if (cmd === 'expire') return 1
    if (cmd === 'lpush') { lists.set(args[0], [args[1], ...(lists.get(args[0]) || [])]); return 1 }
    if (cmd === 'ltrim') return 'OK'
    if (cmd === 'lrange') return lists.get(args[0]) || []
    throw new Error(`unexpected ${cmd}`)
  }),
  redisSetBody: vi.fn(async (k, v) => { store.set(k, v); return 'OK' })
}))

const {
  draftKitEmail, seedKits, listKits, prepareMove, confirmMove, returnKit, saveKitSettings, checkKit
} = await import('./_kits.js')
const { DEFAULT_CONTACTS } = await import('./_bookingNotices.js')

const BEN = { name: 'Ben Cassidy', email: 'ben@technomed.com.au', firstName: 'Ben' }
const KIT = { id: 'diplomat-clv-1', name: 'Diplomat 1', system: 'Diplomat', kind: 'consignment',
  home: 'CLV', trays: ['Rods and tulips 3-5', 'Pedicle screws 2-5'] }
const draft = extra => draftKitEmail({
  kit: KIT, from: 'CLV', to: 'RHH', trays: KIT.trays, date: '2026-11-03', today: '2026-11-03',
  sender: BEN, contacts: DEFAULT_CONTACTS, team: ['mat@technomed.com.au'], ...extra
})

beforeEach(() => { store.clear(); lists.clear() })

describe('who is told', () => {
  it('tells both hospitals when a kit goes from one to the other', () => {
    const email = draft()
    expect(email.to).toEqual(['rhhcsdloancoordinator@ths.tas.gov.au',
      'Sharon.Ashworth@calvarycare.org.au', 'TAS-LVH-Loansets@calvarycare.org.au'])
    expect(email.cc).toEqual(['bookings@technomed.com.au', 'mat@technomed.com.au'])
    expect(email.text).toMatch(/^Hi Katelin, Sharon and Loans team,/)
  })

  it('tells only the receiving hospital when it leaves the office', () => {
    const email = draft({ from: 'office', to: 'CLV' })
    expect(email.to).toEqual(['Sharon.Ashworth@calvarycare.org.au', 'TAS-LVH-Loansets@calvarycare.org.au'])
  })

  it('tells nobody when a kit goes to the office', () => {
    expect(draft({ from: 'RHH', to: 'office' })).toBeNull()
  })
})

describe('what they are told', () => {
  it('lists the trays going, says so when it is not all of them, and names the case', () => {
    const email = draft({ trays: ['Pedicle screws 2-5'], caseDate: '2026-11-05', surname: 'Testa', date: '2026-11-04' })
    expect(email.text).toContain('will be moving the Diplomat consignment tray from Calvary Lenah Valley to the Royal Hobart Hospital on Wednesday 4 November.')
    expect(email.text).toContain('Diplomat (1 of 2 trays):\n- Pedicle screws 2-5')
    expect(email.text).not.toContain('Rods and tulips')
    expect(email.text).toContain('needed for a case at RHH on Thursday 5 November — please assign it to pt Testa.')
    expect(email.text).toMatch(/Any questions, let me know\.$/)
  })

  it('says "today" for a move today, and never claims more than it knows', () => {
    const email = draft()
    expect(email.text).toContain('is moving the Diplomat consignment trays from Calvary Lenah Valley to the Royal Hobart Hospital today.')
    expect(email.text).not.toMatch(/needed for a case/)
    expect(email.text).not.toMatch(/nothing required|we'll handle/i)
  })
})

describe('the starting list', () => {
  it('has one kit per consigned set, each at the hospital that holds it', () => {
    const kits = seedKits()
    expect(kits.filter(k => k.system === 'Diplomat' && k.home === 'CLV')).toHaveLength(3)
    expect(kits.find(k => k.system === 'Lonestar' && k.home === 'RHH').trays).toContain('KT Medical bed arm')
    expect(new Set(kits.map(k => k.id)).size).toBe(kits.length)
  })
})

describe('the kit list as Brent corrected it on 2 Nov', () => {
  it('has the Outrigger consigned at Calvary and no Reform Lumbar, for a new list', () => {
    const kits = seedKits()
    expect(kits.find(k => k.system === 'Mariner Outrigger')).toMatchObject({ kind: 'consignment', home: 'CLV' })
    expect(kits.some(k => k.system === 'Reform Lumbar')).toBe(false)
    expect(kits.filter(k => k.kind === 'floating').map(k => [k.system, k.home]))
      .toEqual([['Shoreline', 'office'], ['Dakota', 'office']])
  })

  it('corrects a list saved before, once', async () => {
    const old = [
      { id: 'mariner-outrigger-floating', name: 'Mariner Outrigger (TM loan)', system: 'Mariner Outrigger', distributor: 'device', kind: 'floating', home: 'office', trays: ['Connectors'] },
      { id: 'reform-lumbar-office', name: 'Reform Lumbar', system: 'Reform Lumbar', distributor: 'e4', kind: 'floating', home: 'office', trays: [] }
    ]
    store.set('kits:defs', JSON.stringify(old))
    const kits = await listKits()
    expect(kits).toHaveLength(1)
    expect(kits[0]).toMatchObject({ id: 'mariner-outrigger-clv', kind: 'consignment', home: 'CLV', at: 'CLV', trays: ['Connectors'] })
    // A later edit is not undone by the correction running again.
    store.set('kits:defs', JSON.stringify([...kits.map(({ at, away, checkedAt, checkedBy, ...k }) => k), old[1]]))
    expect((await listKits()).map(k => k.id)).toContain('reform-lumbar-office')
  })
})

describe('moving and returning', () => {
  it('moves nothing until the move is confirmed, and sends nothing while emails are off', async () => {
    const kit = (await listKits()).find(k => k.home === 'CLV' && k.system === 'Diplomat')
    const preview = await prepareMove({ kitId: kit.id, to: 'RHH', trays: kit.trays, today: '2026-11-03' }, BEN)
    expect(preview.email.to).toContain('rhhcsdloancoordinator@ths.tas.gov.au')
    expect((await listKits()).find(k => k.id === kit.id).at).toBe('CLV')

    const send = vi.fn()
    const done = await confirmMove({ id: preview.id, send: true }, BEN, send)
    expect(send).not.toHaveBeenCalled()
    expect(done.emailed).toBe(false)
    const moved = (await listKits()).find(k => k.id === kit.id)
    expect(moved.at).toBe('RHH')
    expect(moved.away).toBeTruthy()
  })

  it('sends the edited words once emails are on, to the recipients it chose', async () => {
    await saveKitSettings({ emailsOn: true }, 'Brent')
    const kit = (await listKits()).find(k => k.home === 'CLV' && k.system === 'Diplomat')
    const preview = await prepareMove({ kitId: kit.id, to: 'RHH', trays: kit.trays, today: '2026-11-03' }, BEN)
    const send = vi.fn()
    await confirmMove({ id: preview.id, send: true, text: 'Edited words' }, BEN, send)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].text).toBe('Edited words')
    expect(send.mock.calls[0][0].to).toEqual(preview.email.to)
  })

  it('does not record a move whose email failed, so it can be tried again', async () => {
    await saveKitSettings({ emailsOn: true }, 'Brent')
    const kit = (await listKits()).find(k => k.home === 'CLV' && k.system === 'Diplomat')
    const preview = await prepareMove({ kitId: kit.id, to: 'RHH', trays: kit.trays, today: '2026-11-03' }, BEN)
    await expect(confirmMove({ id: preview.id, send: true }, BEN, async () => { throw new Error('refused') })).rejects.toThrow()
    expect((await listKits()).find(k => k.id === kit.id).at).toBe('CLV')
  })

  it('only lets the person who started a move confirm it', async () => {
    const kit = (await listKits())[0]
    const to = kit.home === 'RHH' ? 'CLV' : 'RHH'
    const preview = await prepareMove({ kitId: kit.id, to, trays: kit.trays, today: '2026-11-03' }, BEN)
    await expect(confirmMove({ id: preview.id }, { email: 'someone@technomed.com.au' }, vi.fn())).rejects.toThrow(/Only the person/)
  })

  it('returns a kit home without emailing anybody', async () => {
    await saveKitSettings({ emailsOn: true }, 'Brent')
    const kit = (await listKits()).find(k => k.home === 'CLV' && k.system === 'Diplomat')
    const preview = await prepareMove({ kitId: kit.id, to: 'RHH', trays: kit.trays, today: '2026-11-03' }, BEN)
    await confirmMove({ id: preview.id, send: false }, BEN, vi.fn())
    const back = await prepareMove({ kitId: kit.id, to: 'CLV', trays: kit.trays, today: '2026-11-04' }, BEN)
    expect(back.isReturn).toBe(true)
    expect(back.email).toBeNull()
    await returnKit(kit.id, BEN).catch(() => {})
    expect((await listKits()).find(k => k.id === kit.id).at).toBe('CLV')
  })

  it('records a stock-take, including a kit found somewhere else', async () => {
    const kit = (await listKits()).find(k => k.home === 'CLV')
    await checkKit(kit.id, 'office', 'Ben')
    const now = (await listKits()).find(k => k.id === kit.id)
    expect(now.at).toBe('office')
    expect(now.checkedBy).toBe('Ben')
  })
})

describe("TechnoMed's own kits in the first kit list", () => {
  it('has one TM removal kit, at Calvary, as ours', async () => {
    const { seedKits } = await import('./_kits.js')
    const removal = seedKits().filter(k => /removal/i.test(k.system))
    expect(removal).toEqual([expect.objectContaining({ system: 'TM Screw Removal', home: 'CLV', kind: 'technomed' })])
  })
})
