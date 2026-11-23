import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Moving something that is not one of our kits (Brent, 23 Nov 2026) ──────
// A hospital's Brainlab trays, or a kit not in the kit room yet: the loans
// teams emailed, the courier offered, nothing's location kept. Fake surnames.

const store = new Map()
const lists = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, ...args) => {
    if (cmd === 'get') return store.get(args[0]) ?? null
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

const { draftOtherEmail, prepareOtherMove, confirmOtherMove, logCourierCall, kitHistory } = await import('./_kits.js')
const { DEFAULT_CONTACTS } = await import('./_bookingNotices.js')

const BEN = { name: 'Ben Cassidy', email: 'ben@technomed.com.au', firstName: 'Ben' }
const draft = extra => draftOtherEmail({
  item: 'Brainlab cranial trays', owner: 'RHH', from: 'RHH', to: 'CLV', trays: [], date: '2026-11-24', today: '2026-11-24',
  contacts: DEFAULT_CONTACTS, team: ['mat@technomed.com.au'], ...extra
})

beforeEach(() => { store.clear(); lists.clear() })

describe('the email', () => {
  it('tells both hospitals, and says whose it is', () => {
    const email = draft({ trays: ['Cranial instruments', 'Reference arrays'] })
    expect(email.to).toEqual(['Sharon.Ashworth@calvarycare.org.au', 'TAS-LVH-Loansets@calvarycare.org.au',
      'rhhcsdloancoordinator@ths.tas.gov.au'])
    expect(email.cc).toContain('bookings@technomed.com.au')
    expect(email.cc).toEqual(expect.arrayContaining(['Brett.Battersby@calvarycare.org.au', 'Julie.Robinson@calvarycare.org.au', 'tobias.long@ths.tas.gov.au']))
    expect(email.text).toMatch(/is moving the Brainlab cranial trays \(RHH's\) from the Royal Hobart Hospital to Calvary Lenah Valley today\./)
    expect(email.text).toMatch(/- Cranial instruments\n- Reference arrays/)
    expect(email.subject).toBe('TechnoMed transfer — Brainlab cranial trays to Calvary 24/11')
  })

  it('tells the hospital it leaves when it comes to the office — usually theirs', () => {
    const email = draft({ from: 'RHH', to: 'office', owner: 'Brainlab' })
    expect(email.to).toEqual(['rhhcsdloancoordinator@ths.tas.gov.au'])
    expect(email.text).toMatch(/\(Brainlab's\) from the Royal Hobart Hospital to the TechnoMed office/)
  })

  it('names the case when there is one', () => {
    expect(draft({ caseDate: '2026-11-26', surname: 'Testa' }).text).toMatch(/case at Calvary on Thursday 26 November — please assign it to pt Testa/)
  })
})

describe('the move', () => {
  it('sends the edited email and puts it on the movement history — no kit is changed', async () => {
    const preview = await prepareOtherMove({ item: 'Brainlab cranial trays', owner: 'RHH', from: 'RHH', to: 'CLV', trays: 'Cranial instruments\n\n', today: '2026-11-24' }, BEN)
    expect(preview.trays).toEqual(['Cranial instruments'])
    const send = vi.fn(async () => {})
    const done = await confirmOtherMove({ id: preview.id, send: true, text: 'Edited words' }, BEN, send)
    expect(done.emailed).toBe(true)
    expect(send.mock.calls[0][0].text).toBe('Edited words')
    const history = await kitHistory()
    expect(history[0]).toMatchObject({ kind: 'other', kitName: 'Brainlab cranial trays', emailed: true })
    expect(history[0].text).toMatch(/RHH → Calvary for RHH \(not one of our kits\) · hospital emailed/)
    expect([...store.keys()].some(k => k.startsWith('kits:loc:'))).toBe(false)
    // Done once.
    await expect(confirmOtherMove({ id: preview.id, send: true }, BEN, send)).rejects.toThrow(/expired/)
  })

  it('is sent whatever the kit-move email switch says (it waits on our own stock-take)', async () => {
    store.set('kits:settings', JSON.stringify({ emailsOn: false }))
    const preview = await prepareOtherMove({ item: 'Brainlab trays', from: 'RHH', to: 'CLV', today: '2026-11-24' }, BEN)
    const send = vi.fn(async () => {})
    await confirmOtherMove({ id: preview.id, send: true }, BEN, send)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('refuses a move with nothing named, or to where it already is, and anyone else confirming it', async () => {
    await expect(prepareOtherMove({ item: ' ', from: 'RHH', to: 'CLV' }, BEN)).rejects.toThrow(/what is being moved/)
    await expect(prepareOtherMove({ item: 'Trays', from: 'RHH', to: 'RHH' }, BEN)).rejects.toThrow(/already there/)
    const preview = await prepareOtherMove({ item: 'Trays', from: 'RHH', to: 'CLV', today: '2026-11-24' }, BEN)
    await expect(confirmOtherMove({ id: preview.id }, { email: 'someone@technomed.com.au' }, vi.fn())).rejects.toThrow(/Only the person/)
  })

  it('never confirms a kit move by its id', async () => {
    store.set('kits:pending:diplomat-1', JSON.stringify({ id: 'diplomat-1', by: BEN.email }))
    await expect(confirmOtherMove({ id: 'diplomat-1' }, BEN, vi.fn())).rejects.toThrow(/expired/)
  })

  it('logs a courier called for it by its name', async () => {
    await logCourierCall({ itemName: 'Brainlab cranial trays', courierId: 'jet' }, 'Ben')
    expect((await kitHistory())[0]).toMatchObject({ kind: 'courier', kitName: 'Brainlab cranial trays', text: 'Courier called: Jet Couriers' })
  })
})
