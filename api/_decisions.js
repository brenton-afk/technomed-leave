import { redis, redisSetBody, getUsageHistory, getCaseResupplies, getBookingQueue } from './_redis.js'
import { listThreadsOf, threadMetaOf, readMessageHeadline, addressOf } from './_gmail.js'
import { askClaude } from './_anthropic.js'
import { withoutFences, completeObjects } from './_actionItems.js'
import { owingFor, caseLine } from './_usageReminders.js'
import { itemsFor, compareResupply } from './_resupply.js'
import { DISTRIBUTORS } from './_distributors.js'
import { todayStr } from '../src/clinicalPlan/week.js'

// ─── Decisions — trial on one login (Brent, 7 Nov 2026) ──────────────────────
// "I need to see this functioning before we build it and fold it into the
// portal. Could I test it on my portal login only to begin with?"
//
// One list of what is waiting on somebody, each item with the person it
// belongs to: emails nobody has answered (read from the shared inboxes), usage
// not sent, resupply still owed, bookings waiting in the Inbox. Read-only from
// end to end — nothing is sent, labelled or marked. A suggested reply is text
// to copy into Gmail, never a send.
//
// What a person does with an item (done, not needed, wrong person, later) is
// kept, and "not needed" with its reason is handed to the next review as a
// lesson — so the list learns what this business does not need flagged.

export const OWNERS = {
  brent: 'Brent',
  toni: 'Toni',
  erin: 'Erin',
  leader: 'Team leader',
  clinical: 'Clinical team'
}

const PERSON_OWNER = { brenton: 'brent', toni: 'toni', erin: 'erin' }

/** The owners whose items are this person's: their own, plus "Team leader" on a day they lead. */
export function ownersFor(email, leaderEmail) {
  const e = String(email || '').toLowerCase()
  const own = PERSON_OWNER[e.split('@')[0]]
  return [...(own ? [own] : []), ...(e && e === String(leaderEmail || '').toLowerCase() ? ['leader'] : [])]
}

/** Who may open it. DECISIONS_USERS, else Brent alone while it is a trial. */
export function decisionUsers(env = process.env) {
  return String(env.DECISIONS_USERS || 'brenton@technomed.com.au')
    .split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
}
export function mayUseDecisions(email, env = process.env) {
  return Boolean(email) && decisionUsers(env).includes(String(email).toLowerCase())
}

/** The inboxes read, each with whose it is by default. */
export function decisionMailboxes(env = process.env) {
  const list = String(env.DECISIONS_MAILBOXES
    || 'brenton@technomed.com.au,bookings@technomed.com.au,accounts@technomed.com.au,admin@technomed.com.au')
    .split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  return list.map(address => ({ address, owner: defaultOwner(address) }))
}

// What each shared inbox is for (Brent, 7 Nov 2026): bookings@ is cases and
// loan sets; accounts@ is invoices, sales reports and payments; admin@ is POs,
// resupply and stock follow-up.
export const MAILBOX_PURPOSE = {
  bookings: 'cases, theatre bookings and loan sets',
  accounts: 'invoices, sales reports and payments',
  admin: 'purchase orders, resupply and stock follow-up',
  brenton: "the director's own inbox"
}

export function defaultOwner(address) {
  const user = String(address).split('@')[0]
  if (user === 'bookings') return 'leader'
  if (user === 'accounts' || user === 'admin' || user.startsWith('toni')) return 'toni'
  if (user.startsWith('erin')) return 'erin'
  return 'brent'
}

const OUR_DOMAIN = /@technomed\.com\.au$/i
const AUTOMATED = /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|alerts?|news(letter)?|marketing|bounce|calendar-notification|invoices?@xero|messaging-service)([._-]|@)/i
const AUTOMATED_SUBJECT = /^(accepted|declined|tentative|updated invitation|invitation):|out of office|automatic reply|delivery status notification|undeliverable|your (receipt|order|statement)|unsubscribe/i

/** An email no person needs to answer: a robot, a calendar echo, an out-of-office. */
export function isAutomated(from, subject = '') {
  const address = addressOf(from)
  return AUTOMATED.test(address) || AUTOMATED_SUBJECT.test(String(subject).trim())
}

/** Ours: sent from this mailbox, or by anyone at TechnoMed. */
export function isOurs(message) {
  return (message.labelIds || []).includes('SENT') || OUR_DOMAIN.test(addressOf(message.from))
}

export const WAIT_HOURS = 20

/**
 * Whether a thread is waiting on us: its last message came from outside, from
 * a person, at least WAIT_HOURS ago. A reply from anyone at TechnoMed ends the
 * wait — whoever answered, it has been answered.
 */
export function waitingOnUs(messages, { now = Date.now(), waitHours = WAIT_HOURS } = {}) {
  const last = messages[messages.length - 1]
  if (!last || isOurs(last) || isAutomated(last.from, last.subject)) return null
  const hours = (now - Date.parse(last.at || 0)) / 3600000
  if (!(hours >= waitHours)) return null
  return { last, hours, days: Math.floor(hours / 24) }
}

/** The new part of an email: quoted history and signatures cut off. */
export function freshText(text, max = 1500) {
  const lines = String(text || '').split(/\r?\n/)
  const out = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue
    if (/^On .{6,120}wrote:\s*$/.test(line.trim())) break
    if (/^-{2,}\s*Original Message|^From:\s.+/i.test(line.trim()) && out.length) break
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}

export function gmailLink(mailbox, threadId) {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox)}#all/${threadId}`
}

// ─── Reading the inbox ───────────────────────────────────────────────────────

const INBOX_QUERY = process.env.DECISIONS_QUERY
  || 'in:inbox newer_than:30d -category:promotions -category:social -category:forums -category:updates'
const MAX_THREADS = 40
const MODEL = process.env.DECISIONS_MODEL || 'claude-opus-5'
const TRIAGE_DAYS = 30

async function inChunks(list, size, fn) {
  const out = []
  for (let i = 0; i < list.length; i += size) {
    out.push(...await Promise.all(list.slice(i, i + size).map(fn)))
  }
  return out
}

const triageKey = (mailbox, messageId) => `decisions:triage:${mailbox}:${messageId}`

export function triagePrompt(mailbox, owner, threads, lessons = []) {
  const learned = lessons.length
    ? `\nBrent has already told you these did not need flagging — treat anything like them the same way:\n${
      lessons.map(l => `- from ${l.from || 'someone'}${l.subject ? `, "${l.subject}"` : ''}: ${l.reason || 'not needed'}`).join('\n')}\n`
    : ''
  const purpose = MAILBOX_PURPOSE[String(mailbox).split('@')[0]]
  return `You are reviewing the ${mailbox} inbox${purpose ? ` (${purpose})` : ''} for TechnoMed, a nine-person surgical implant distributor in Hobart, Tasmania (spinal, orthopaedic and CMF implants, supporting surgeons at Calvary and the Royal Hobart Hospital).

Each thread below has had no reply from anyone at TechnoMed. Decide whether it needs somebody here to do or answer something. Most inbox mail does not: receipts, distributor news, booking lists sent for information (the portal reads booking lists by itself), confirmations, thank-yous, CCs, anything already resolved in the thread.

Who owns what:
- toni: invoices, sales reports, payments, remittances, purchase orders, resupply and stock follow-up, supplier accounts
- erin: staff and people matters, contracts, distributor relationship and terms, bigger-picture strategy
- leader: cases, theatre bookings, questions from hospitals or surgeons' rooms, kit and loan sets
- clinical: usage forms and anything a rep in theatre has to do
- brent: anything else, and anything only the director can decide
The default owner for this inbox is ${owner}.
${learned}
Patients: refer to a patient by surname only. Never write a first name, date of birth or UR number.

Reply with only a JSON array, one object per thread, in the order given:
{"n": <thread number>, "action": true|false, "owner": "toni|erin|leader|clinical|brent", "summary": "<what it is, under 15 words>", "ask": "<what is needed from us, under 20 words>", "urgency": "today|week|later", "draft": "<a short reply ready to send, in Australian English, signed off without a name; empty if a reply is not the right action>"}

Threads:
${threads.map((t, i) => `
### Thread ${i + 1}
From: ${t.last.from}
Subject: ${t.last.subject}
Waiting: ${t.days} day${t.days === 1 ? '' : 's'}
Messages in thread: ${t.count}
Latest message:
${t.text || t.last.snippet}`).join('\n')}`
}

export function parseTriage(text) {
  const clean = withoutFences(text)
  try {
    const parsed = JSON.parse(clean)
    if (Array.isArray(parsed)) return parsed
  } catch { /* fall through to the objects that are complete */ }
  return completeObjects(clean).map(s => { try { return JSON.parse(s) } catch { return null } }).filter(Boolean)
}

async function triage(mailbox, owner, threads, lessons) {
  if (!threads.length) return []
  const answer = await askClaude({
    feature: 'decisions',
    whenUnavailable: 'The inbox review is unavailable right now — try again shortly.',
    timeoutMs: 90000,
    request: {
      model: MODEL, max_tokens: 6000,
      messages: [{ role: 'user', content: triagePrompt(mailbox, owner, threads, lessons) }]
    }
  })
  const text = (answer.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  return parseTriage(text)
}

export function cleanVerdict(v = {}, fallbackOwner = 'brent') {
  return {
    action: v.action === true,
    owner: OWNERS[v.owner] ? v.owner : fallbackOwner,
    summary: String(v.summary || '').slice(0, 200),
    ask: String(v.ask || '').slice(0, 240),
    urgency: ['today', 'week', 'later'].includes(v.urgency) ? v.urgency : 'week',
    draft: String(v.draft || '').slice(0, 2000)
  }
}

/** One mailbox, read and judged. Threads already judged at the same last message are not asked again. */
export async function reviewMailbox({ address, owner }, { now = Date.now(), lessons = [] } = {}) {
  const ids = await listThreadsOf(address, INBOX_QUERY, { max: MAX_THREADS })
  const metas = await inChunks(ids, 8, id => threadMetaOf(address, id).then(m => ({ id, messages: m })).catch(() => null))
  const waiting = metas.filter(Boolean)
    .map(t => ({ threadId: t.id, count: t.messages.length, ...waitingOnUs(t.messages, { now }) }))
    .filter(t => t.last)

  const cached = waiting.length
    ? await redis('mget', ...waiting.map(t => triageKey(address, t.last.id))).catch(() => [])
    : []
  const fresh = []
  waiting.forEach((t, i) => {
    try { if (cached[i]) t.verdict = JSON.parse(cached[i]) } catch { /* judge again */ }
    if (!t.verdict) fresh.push(t)
  })

  await inChunks(fresh, 8, async t => {
    try {
      const m = await readMessageHeadline(address, t.last.id)
      t.text = freshText(m.text)
    } catch { t.text = '' }
  })
  for (let i = 0; i < fresh.length; i += 12) {
    const batch = fresh.slice(i, i + 12)
    const verdicts = await triage(address, owner, batch, lessons)
    for (const v of verdicts) {
      const t = batch[Number(v.n) - 1]
      if (!t) continue
      t.verdict = cleanVerdict(v, owner)
      await redis('set', triageKey(address, t.last.id), JSON.stringify(t.verdict),
        'EX', String(TRIAGE_DAYS * 86400)).catch(() => {})
    }
  }

  return waiting
    .filter(t => t.verdict?.action)
    .map(t => ({
      id: `email:${t.threadId}:${t.last.id}`,
      source: 'email',
      mailbox: address,
      owner: t.verdict.owner,
      title: t.verdict.summary || t.last.subject || '(no subject)',
      detail: `${t.last.from.replace(/<[^>]+>/, '').trim() || addressOf(t.last.from)} · ${t.last.subject || '(no subject)'}`,
      ask: t.verdict.ask,
      urgency: t.verdict.urgency,
      waitingDays: t.days,
      draft: t.verdict.draft,
      link: gmailLink(address, t.threadId),
      from: addressOf(t.last.from),
      subject: t.last.subject || ''
    }))
}

const inboxKey = mailbox => `decisions:inbox:${mailbox}`
export const STALE_MINUTES = 30

export async function readInboxReviews(mailboxes = decisionMailboxes()) {
  const raws = await redis('mget', ...mailboxes.map(m => inboxKey(m.address))).catch(() => [])
  return mailboxes.map((m, i) => {
    try { return { ...m, ...(raws[i] ? JSON.parse(raws[i]) : {}) } } catch { return { ...m } }
  })
}

/** Reads every mailbox again and stores what is waiting. Each mailbox succeeds or fails on its own. */
export async function refreshInboxes({ mailboxes = decisionMailboxes(), now = Date.now() } = {}) {
  const lessons = await readLessons(30)
  return Promise.all(mailboxes.map(async m => {
    const at = new Date(now).toISOString()
    let record
    try {
      record = { at, items: await reviewMailbox(m, { now, lessons }) }
    } catch (err) {
      const prior = (await readInboxReviews([m]))[0] || {}
      record = { at: prior.at || null, items: prior.items || [], error: String(err.message || err).slice(0, 300), failedAt: at }
    }
    await redisSetBody(inboxKey(m.address), JSON.stringify(record))
    return { address: m.address, ...record }
  }))
}

// ─── What the portal already knows ───────────────────────────────────────────

/** Usage not sent for cases on the last three working days. */
export async function usageItems(today = todayStr()) {
  const days = []
  for (let n = 1; days.length < 3 && n < 8; n++) {
    const at = new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000)
    const dow = at.getUTCDay()
    if (dow !== 0 && dow !== 6) days.push(at.toISOString().slice(0, 10))
  }
  const out = []
  for (const day of days) {
    const { owing } = await owingFor(day)
    for (const c of owing) {
      const waited = Math.round((Date.parse(today) - Date.parse(day)) / 86400000)
      out.push({
        id: `usage:${c.id}`, source: 'usage', owner: 'clinical',
        title: `Usage not sent — ${caseLine(c)}`,
        detail: `${day} · ${c.who.join(', ')}`,
        ask: `${c.who.join(' or ')} to scan and send the usage, or mark it No usage.`,
        urgency: waited >= 2 ? 'today' : 'week', waitingDays: waited
      })
    }
  }
  return out
}

export const RESUPPLY_FROM = process.env.RESUPPLY_TRACK_FROM || '2026-11-06'
export const RESUPPLY_CHASE_DAYS = 7

/** Resupply still owed a week or more after the case — Toni's to chase. */
export async function resupplyItems(today = todayStr()) {
  const records = (await getUsageHistory(150))
    .filter(r => !r.removed && (r.date || '') >= RESUPPLY_FROM)
  const out = []
  for (const record of records) {
    const days = Math.round((Date.parse(today) - Date.parse(record.date)) / 86400000)
    if (!(days >= RESUPPLY_CHASE_DAYS)) continue
    const keys = [...new Set(itemsFor(record).map(i => i.distributorKey).filter(Boolean))]
    if (!keys.length) continue
    const resupplies = await getCaseResupplies(record.id)
    for (const key of keys) {
      const earlier = resupplies.filter(e => e.distributorKey === key
        || (key === 'device_boost' && e.distributorKey === 'device') || (key === 'device' && e.distributorKey === 'device_boost'))
      const { totals } = compareResupply(record, key, [], earlier)
      if (totals.owing <= 0) continue
      const name = DISTRIBUTORS[key]?.name || key
      out.push({
        id: `resupply:${record.id}:${key}`, source: 'resupply', owner: 'toni',
        title: `Resupply owed — ${name}`,
        detail: `${record.folderName || record.patientSurname || 'Case'} · ${totals.owing} of ${totals.used} still owed`,
        ask: `Chase ${name} for the outstanding resupply.`,
        urgency: days >= 14 ? 'today' : 'week', waitingDays: days
      })
    }
  }
  return out
}

/** Bookings read from email and not yet accepted or dismissed. */
export async function bookingInboxItems(now = Date.now()) {
  const pending = (await getBookingQueue()).filter(c => c.status === 'pending')
  if (!pending.length) return []
  const oldest = pending.reduce((a, b) => (String(a.createdAt) < String(b.createdAt) ? a : b))
  const days = Math.floor((now - Date.parse(oldest.createdAt || now)) / 86400000)
  return [{
    id: `bookings:${pending.length}:${oldest.id}`, source: 'bookings', owner: 'leader',
    title: `${pending.length} booking${pending.length === 1 ? '' : 's'} waiting in the Inbox`,
    detail: 'Cases → Inbox',
    ask: 'Accept or dismiss each one so the calendar is complete.',
    urgency: days >= 1 ? 'today' : 'week', waitingDays: days
  }]
}

// ─── What people did with an item ────────────────────────────────────────────

export const STATES = ['done', 'not-needed', 'wrong-person', 'later']
const stateKey = email => `decisions:state:${email}`
const LESSONS = 'decisions:lessons'
const LOG = 'decisions:log'

export async function readStates(email) {
  const flat = (await redis('hgetall', stateKey(email))) || []
  const out = {}
  if (Array.isArray(flat)) {
    for (let i = 0; i < flat.length; i += 2) {
      try { out[flat[i]] = JSON.parse(flat[i + 1]) } catch { /* skip */ }
    }
  } else {
    for (const [k, v] of Object.entries(flat)) { try { out[k] = JSON.parse(v) } catch { /* skip */ } }
  }
  return out
}

export async function markItem(email, name, { id, state, reason = '', item = {} }, now = Date.now()) {
  if (!STATES.includes(state) && state !== 'open') throw Object.assign(new Error('Unknown choice'), { status: 400 })
  if (state === 'open') {
    await redis('hdel', stateKey(email), id)
    return null
  }
  const entry = {
    state, at: new Date(now).toISOString(), reason: String(reason).slice(0, 300),
    until: state === 'later' ? new Date(now + 3 * 86400000).toISOString() : null
  }
  await redis('hset', stateKey(email), id, JSON.stringify(entry))
  const logged = {
    by: name, at: entry.at, state, reason: entry.reason, source: item.source || String(id).split(':')[0],
    owner: item.owner || '', from: item.from || '', subject: String(item.subject || '').slice(0, 120)
  }
  await redis('lpush', LOG, JSON.stringify(logged))
  await redis('ltrim', LOG, '0', '999')
  if (state === 'not-needed' && item.source === 'email') {
    await redis('lpush', LESSONS, JSON.stringify({ from: item.from, subject: logged.subject, reason: entry.reason }))
    await redis('ltrim', LESSONS, '0', '99')
  }
  return entry
}

export async function readLessons(n = 30) {
  const raw = (await redis('lrange', LESSONS, '0', String(n - 1)).catch(() => [])) || []
  return raw.map(s => { try { return JSON.parse(s) } catch { return null } }).filter(Boolean)
}

/** Items still open for this person: not done, not dismissed, and any "later" whose time has come. */
export function openItems(items, states, now = Date.now()) {
  return items.filter(item => {
    const s = states[item.id]
    if (!s) return true
    if (s.state === 'later') return Date.parse(s.until || 0) <= now
    return false
  })
}

const URGENCY = { today: 0, week: 1, later: 2 }
export function ranked(items) {
  return [...items].sort((a, b) => (URGENCY[a.urgency] ?? 1) - (URGENCY[b.urgency] ?? 1)
    || (b.waitingDays || 0) - (a.waitingDays || 0))
}

// ─── One email, one item (Brent, 8 Nov 2026) ─────────────────────────────────
// KT Medical's October report reached brenton@ and accounts@, and showed twice
// — two people could have invoiced it twice. The same sender and subject in
// several inboxes is one item: kept from the inbox whose usual owner matches
// who it is for (accounts@ for Toni), the others listed beside it. Its `ids`
// carry every copy, so dealing with it deals with all of them.
const subjectKey = s => String(s || '').toLowerCase().replace(/^((re|fwd?|fw)\s*:\s*)+/g, '').replace(/\s+/g, ' ').trim()

export function mergeDuplicateEmails(items, mailboxes = decisionMailboxes()) {
  const ownerOf = Object.fromEntries(mailboxes.map(m => [m.address, m.owner]))
  const groups = new Map()
  const out = []
  for (const item of items) {
    if (item.source !== 'email' || !item.from) { out.push(item); continue }
    const key = `${item.from}|${subjectKey(item.subject)}`
    if (!groups.has(key)) { groups.set(key, []); out.push(key) }
    groups.get(key).push(item)
  }
  return out.map(entry => {
    if (typeof entry !== 'string') return entry
    const copies = groups.get(entry)
    if (copies.length === 1) return { ...copies[0], ids: [copies[0].id] }
    const keep = copies.find(c => ownerOf[c.mailbox] === c.owner) || copies[0]
    return {
      ...keep,
      ids: copies.map(c => c.id),
      alsoIn: copies.filter(c => c !== keep).map(c => c.mailbox)
    }
  })
}

/** Open unless every copy of it has been dealt with. */
export function openMerged(items, states, now = Date.now()) {
  return items.filter(item => (item.ids || [item.id]).some(id => openItems([{ id }], states, now).length))
}
