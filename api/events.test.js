import { describe, it, expect, vi, beforeEach } from 'vitest'

// Events, contacts and RSVPs (Brent, 25 Nov 2026). Invented people only.

const store = new Map()
vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (cmd, key, ...rest) => {
    if (cmd === 'get') return store.get(key) ?? null
    if (cmd === 'set') { if (rest.includes('NX') && store.has(key)) return null; store.set(key, rest[0]); return 'OK' }
    if (cmd === 'del') { store.delete(key); return 1 }
    return null
  }),
  redisSetBody: vi.fn(async (key, value) => { store.set(key, value) })
}))
const mail = []
vi.mock('./_email.js', () => ({
  PORTAL_URL: 'https://portal.example.test',
  sendEventEmail: vi.fn(async m => { mail.push(m) }),
  personSignoff: () => ({ name: 'Pat Admin', role: 'Director', contact: 'pat@example.test' })
}))
const texts = []
let smsOn = true
vi.mock('./_clicksend.js', () => ({
  clicksendConfigured: () => smsOn,
  sendClickSendSms: vi.fn(async (to, body) => { texts.push({ to, body }) })
}))
vi.mock('./_dropbox.js', () => ({ uploadFile: vi.fn(), temporaryLink: vi.fn(async () => ({ url: 'https://dl.example.test/x' })), ensureFolder: vi.fn() }))
vi.mock('../src/staffConfig.js', () => ({
  STAFF: [
    { name: 'Pat Admin', firstName: 'Pat', email: 'pat@example.test', isAdmin: true },
    { name: 'Sam Rep', firstName: 'Sam', email: 'sam@example.test' },
    { name: 'Kim Other', firstName: 'Kim', email: 'kim@example.test' }
  ]
}))

const ev = await import('./_events.js')
const admin = { email: 'pat@example.test' }
const sam = { email: 'sam@example.test' }
const kim = { email: 'kim@example.test' }

beforeEach(() => { store.clear(); mail.length = 0; texts.length = 0; smsOn = true })

async function setUp({ capacity = 0 } = {}) {
  await ev.importContacts([
    { name: 'Dr Ann Surgeon', email: 'ann@hosp.example', mobile: '0400 000 001', group: 'Surgeon' },
    { name: 'Dr Ben Reg', email: 'ben@hosp.example', group: 'Registrar/Fellow' },
    { name: 'Cat Nurse', email: 'cat@hosp.example', mobile: '0400000003', group: 'Theatre/Nursing' }
  ], 'email')
  const contacts = await ev.listContacts()
  const { id } = await ev.saveEvent({
    title: 'Spine Dinner', kind: 'dinner', start: new Date(Date.now() + 7 * 864e5).toISOString(), capacity,
    organisers: ['sam@example.test'], form: [{ id: 'diet', label: 'Dietary', type: 'chips', options: ['Vegetarian', 'Gluten free'] }, { id: 'plus', label: 'Partner', type: 'plus' }]
  }, admin)
  await ev.addGuests(id, { contactIds: contacts.map(c => c.id) }, admin)
  return { id, event: await ev.getEvent(id) }
}

describe('who can do what', () => {
  it('lets only an admin start an event', async () => {
    await expect(ev.saveEvent({ title: 'X' }, sam)).rejects.toThrow(/admin/)
  })
  it('lets a named organiser run it and nobody else', async () => {
    const { id, event } = await setUp()
    expect(ev.mayOrganise(sam, event)).toBe(true)
    expect(ev.mayOrganise(kim, event)).toBe(false)
    await expect(ev.addGuests(id, { people: [{ name: 'Someone' }] }, kim)).rejects.toThrow(/organiser/)
    expect(await ev.mayUseEvents(sam)).toBe(true)
    expect(await ev.mayUseEvents(kim)).toBe(false)
  })
})

describe('contacts', () => {
  it('merges an import by email and does not duplicate', async () => {
    await setUp()
    const r = await ev.importContacts([{ name: 'Dr Ann Surgeon', email: 'ANN@hosp.example', hospital: 'RHH' }], 'list')
    expect(r).toMatchObject({ added: 0, merged: 1, total: 3 })
    expect((await ev.listContacts()).find(c => c.email === 'ann@hosp.example').hospital).toBe('RHH')
  })
  it('fills a phone mobile only onto someone already there, never adds', async () => {
    await setUp()
    const ben = (await ev.listContacts()).find(c => c.name === 'Dr Ben Reg')
    const r = await ev.applyPhoneMobiles([{ id: ben.id, mobile: '0412 345 678' }, { id: 'nobody', mobile: '0412000000' }])
    expect(r.filled).toBe(1)
    expect((await ev.listContacts()).length).toBe(3)
  })
})

describe('a guest replying by their link', () => {
  it('sees only their own invitation and saves only what the form asks', async () => {
    const { event } = await setUp()
    const ann = event.guests.find(g => g.name === 'Dr Ann Surgeon')
    const view = await ev.guestView(ann.token)
    expect(view.guest.name).toBe('Dr Ann Surgeon')
    expect(JSON.stringify(view)).not.toMatch(/ben@hosp|cat@hosp|Ben Reg/)
    const after = await ev.guestReply(ann.token, { status: 'yes', answers: { diet: ['Vegetarian', 'Pizza'], hack: 'x', plus: { coming: true, name: 'Jo' } } })
    expect(after.guest.status).toBe('yes')
    expect(after.guest.answers).toEqual({ diet: ['Vegetarian'], plus: { coming: true, name: 'Jo', diet: '' } })
  })
  it('puts a yes on the waitlist once the places are taken', async () => {
    const { event } = await setUp({ capacity: 2 })
    const [a, b] = event.guests
    await ev.guestReply(a.token, { status: 'yes', answers: { plus: { coming: true, name: 'Jo' } } })
    const second = await ev.guestReply(b.token, { status: 'yes', answers: {} })
    expect(second.guest.status).toBe('waitlist')
  })
  it('refuses a made-up token', async () => {
    expect(await ev.guestView('not-a-real-token-at-all')).toBeNull()
  })
  it('opts the contact out with the unsubscribe link, and sending then skips them', async () => {
    const { id, event } = await setUp()
    const cat = event.guests.find(g => g.name === 'Cat Nurse')
    await ev.guestStop(cat.token)
    const { results } = await ev.sendToGuests(id, { via: ['email', 'sms'], who: 'unsent' }, admin)
    expect(results.find(r => r.name === 'Cat Nurse').skipped).toBe('opted out')
    expect(mail.map(m => m.to[0])).not.toContain('cat@hosp.example')
  })
})

describe('sending', () => {
  it('emails each guest their own link, from the organiser, and texts those with a mobile', async () => {
    const { id, event } = await setUp()
    const { results } = await ev.sendToGuests(id, { via: ['email', 'sms'], who: 'unsent' }, sam)
    expect(mail).toHaveLength(3)
    const ann = event.guests.find(g => g.name === 'Dr Ann Surgeon')
    const toAnn = mail.find(m => m.to[0] === 'ann@hosp.example')
    expect(toAnn.sender.email).toBe('sam@example.test')
    expect(toAnn.html).toContain(`/e/${ann.token}`)
    expect(toAnn.text).toMatch(/Unsubscribe/)
    expect(texts.map(t => t.to).sort()).toEqual(['+61400000001', '+61400000003'])
    expect(texts[0].body).toMatch(/Reply STOP to opt out/)
    expect(results.every(r => r.email === 'sent')).toBe(true)
    // Sent ones are not sent again as "unsent".
    const again = await ev.sendToGuests(id, { via: ['email'], who: 'unsent' }, sam)
    expect(again.results).toHaveLength(0)
  })
  it('says SMS is not set up rather than pretending', async () => {
    smsOn = false
    const { id } = await setUp()
    const { results } = await ev.sendToGuests(id, { via: ['sms'], who: 'unsent' }, admin)
    expect(results.find(r => r.name === 'Dr Ann Surgeon').sms).toBe('not set up')
  })
})

describe('the venue sheet and hospitality record', () => {
  it('lists dietary answers and works out the cost per head', async () => {
    const { id, event } = await setUp()
    const ann = event.guests.find(g => g.name === 'Dr Ann Surgeon')
    await ev.guestReply(ann.token, { status: 'yes', answers: { diet: ['Gluten free'], plus: { coming: true, name: 'Jo', diet: 'Vegan' } } })
    await ev.saveEvent({ id, cost: { total: 400, ourShare: 50 } }, admin)
    const fresh = await ev.getEvent(id)
    expect(ev.venueCsv(fresh)).toMatch(/Gluten free/)
    expect(ev.hospitalityCsv(fresh)).toMatch(/"TechnoMed cost per head \(AUD\)","100\.00"/)
  })
})
