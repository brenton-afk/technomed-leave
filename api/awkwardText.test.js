import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Task 3 acceptance: "a test note containing quotes, apostrophes, line
// breaks and emoji saves and reloads." ─────────────────────────────────────────
// A fake Upstash that behaves like the real one where it matters: path-form
// arguments arrive URL-encoded and are decoded per segment, and a body-form SET
// stores the request body byte for byte. If either write path ever went back to
// string concatenation, or to an unencoded path, this is where it shows.

const store = new Map()
const lists = new Map()

vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
  const segments = String(url).replace('https://redis.test/', '').split('/').map(decodeURIComponent)
  const [command, key, ...rest] = segments
  let result = 'OK'
  if (command === 'set') store.set(key, init.body !== undefined ? String(init.body) : rest[0])
  else if (command === 'get') result = store.get(key) ?? null
  else if (command === 'lpush') lists.set(key, [rest[0], ...(lists.get(key) || [])])
  else if (command === 'lrem') lists.set(key, (lists.get(key) || []).filter(v => v !== rest[1]))
  else if (command === 'lrange') result = lists.get(key) || []
  return { json: async () => ({ result }) }
}))

process.env.UPSTASH_REDIS_REST_URL = 'https://redis.test'
process.env.UPSTASH_REDIS_REST_TOKEN = 'token'

const { saveWorklistItem, updateWorklistItem, getWorklist, saveProject, getProjects } = await import('./_redis.js')

const AWKWARD = [
  'Erin said "ring them first" — don\'t book until it\'s confirmed',
  'Line two\nLine three\r\nand a tab\there',
  'Kit list 👍🦴 ✅ — Reform/Firebird \\ back-slash, 50% & <tags>',
  '{"looks":"like JSON"} } ] , and a lone " quote'
].join('\n')

beforeEach(() => { store.clear(); lists.clear() })

describe('notes with awkward characters', () => {
  it('a task note saves and reloads exactly', async () => {
    await saveWorklistItem({ id: 'w1', task: 'Test task', notes: AWKWARD, status: 'open' })
    const { items, unreadable } = await getWorklist()
    expect(unreadable).toEqual([])
    expect(items[0].notes).toBe(AWKWARD)
  })

  it('survives an update that adds more of it', async () => {
    await saveWorklistItem({ id: 'w2', task: 'Test task', status: 'open' })
    await updateWorklistItem('w2', { notes: AWKWARD, updates: [{ text: AWKWARD }] })
    const { items } = await getWorklist()
    expect(items[0].notes).toBe(AWKWARD)
    expect(items[0].updates[0].text).toBe(AWKWARD)
  })

  it('a project note saves and reloads exactly', async () => {
    await saveProject({ id: 'p1', name: 'Meeting "Q4" — Brent\'s 🚀', notes: AWKWARD })
    const [project] = await getProjects()
    expect(project.name).toBe('Meeting "Q4" — Brent\'s 🚀')
    expect(project.notes).toBe(AWKWARD)
  })

  it('a long note is not cut short (body form, not URL path)', async () => {
    const long = AWKWARD.repeat(400) // ~80KB, well past any request-line limit
    await saveWorklistItem({ id: 'w3', task: 'Long', notes: long })
    const { items } = await getWorklist()
    expect(items[0].notes).toBe(long)
  })
})
