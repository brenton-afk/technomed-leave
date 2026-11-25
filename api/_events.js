// ─── Events, contacts and RSVPs (Brent, 25 Nov 2026) ────────────────────────
// Served from api/guides.js (`events=` for organisers, `rsvp=` for guests, no
// session) — the plan allows twelve functions and the app is at twelve.
//
// Redis:
//   events:contacts       JSON array of contacts (email first; see model.js)
//   events:index          JSON array of event summaries
//   event:{id}            JSON — the event with its guests
//   rsvp:{token}          the event id a guest's link belongs to
//   event:{id}:lock       SET NX while an event is being changed
//
// Who: admins, plus the organisers named on an event (for that event). Contacts
// are for admins and anyone who organises an event. Guests reach only their own
// reply, by an unguessable token in their link.

import { randomBytes, randomUUID } from 'node:crypto'
import { redis, redisSetBody } from './_redis.js'
import { STAFF } from '../src/staffConfig.js'
import { sendEventEmail, PORTAL_URL } from './_email.js'
import { emailShell, para, factsPanel, button, aside, signoff, factsText } from './_emailLayout.js'
import { personSignoff } from './_email.js'
import { clicksendConfigured, sendClickSendSms } from './_clicksend.js'
import { uploadFile, temporaryLink, ensureFolder } from './_dropbox.js'
import {
  GROUPS, EVENT_KINDS, cleanForm, cleanAnswers, defaultForm, seatsFor, summarise,
  normaliseMobile, isMobile, whenText, icsFor
} from '../src/events/model.js'

const CONTACTS = 'events:contacts'
const INDEX = 'events:index'
const eventKey = id => `event:${id}`
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const lower = s => String(s || '').trim().toLowerCase()

async function readJson(key, fallback) {
  const raw = await redis('get', key)
  if (!raw) return fallback
  try { return JSON.parse(raw) } catch { return fallback }
}
const writeJson = (key, value) => redisSetBody(key, JSON.stringify(value))

/** One writer at a time per key; a short wait, then a clear refusal. */
async function withLock(name, fn) {
  const lock = `${name}:lock`
  for (let i = 0; i < 20; i++) {
    if (await redis('set', lock, '1', 'NX', 'PX', '8000')) {
      try { return await fn() } finally { await redis('del', lock).catch(() => {}) }
    }
    await new Promise(r => setTimeout(r, 150))
  }
  throw Object.assign(new Error('Someone else is saving this right now — try again.'), { status: 409 })
}

const isAdmin = email => STAFF.some(s => lower(s.email) === lower(email) && s.isAdmin)
const staffName = email => STAFF.find(s => lower(s.email) === lower(email))?.name || email

export const mayOrganise = (session, event) => Boolean(session?.email) && (isAdmin(session.email)
  || (event?.organisers || []).some(e => lower(e) === lower(session.email)))

/** Whether the Events area is offered: admins, and organisers of any event. */
export async function mayUseEvents(session) {
  if (!session?.email) return false
  if (isAdmin(session.email)) return true
  const index = await readJson(INDEX, [])
  return index.some(e => (e.organisers || []).some(o => lower(o) === lower(session.email)))
}

// ─── Contacts ────────────────────────────────────────────────────────────────

function cleanContact(c, existing = {}) {
  const email = lower(c.email ?? existing.email)
  return {
    id: existing.id || c.id || randomUUID(),
    name: clip(c.name ?? existing.name, 100),
    group: GROUPS.includes(c.group) ? c.group : (existing.group || 'Other'),
    hospital: clip(c.hospital ?? existing.hospital, 80),
    title: clip(c.title ?? existing.title, 100),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
    otherEmails: [...new Set([...(existing.otherEmails || []), ...(c.otherEmails || [])].map(lower).filter(e => e.includes('@') && e !== email))].slice(0, 5),
    mobile: normaliseMobile(c.mobile ?? existing.mobile),
    tags: [...new Set((c.tags ?? existing.tags ?? []).map(t => clip(t, 30)).filter(Boolean))].slice(0, 10),
    sources: [...new Set([...(existing.sources || []), ...(c.sources || [])].map(s => clip(s, 30)).filter(Boolean))],
    lastSeen: clip(c.lastSeen ?? existing.lastSeen, 10),
    optedOut: c.optedOut ?? existing.optedOut ?? null,
    updatedAt: new Date().toISOString()
  }
}

export async function listContacts() {
  return (await readJson(CONTACTS, [])).sort((a, b) => a.name.localeCompare(b.name))
}

/** Add or change one contact. */
export async function saveContact(input, session) {
  return withLock(CONTACTS, async () => {
    const all = await readJson(CONTACTS, [])
    const at = all.findIndex(c => c.id === input.id)
    const next = cleanContact({ ...input, sources: at < 0 ? ['typed'] : [] }, at >= 0 ? all[at] : {})
    if (!next.name) throw Object.assign(new Error('A contact needs a name'), { status: 400 })
    const dupe = next.email && all.find(c => c.id !== next.id && c.email === next.email)
    if (dupe) throw Object.assign(new Error(`${dupe.name} already has that email`), { status: 409 })
    next.updatedBy = session.email
    if (at >= 0) all[at] = next; else all.push(next)
    await writeJson(CONTACTS, all)
    return next
  })
}

export async function removeContact(id) {
  return withLock(CONTACTS, async () => {
    const all = await readJson(CONTACTS, [])
    await writeJson(CONTACTS, all.filter(c => c.id !== id))
    return { removed: true }
  })
}

/**
 * Many at once (the email sweep, a spreadsheet): merged by email, else added.
 * A typed field already there is not overwritten by an empty one.
 */
export async function importContacts(list, source) {
  return withLock(CONTACTS, async () => {
    const all = await readJson(CONTACTS, [])
    const byEmail = new Map(all.filter(c => c.email).map(c => [c.email, c]))
    let added = 0; let merged = 0
    for (const raw of (Array.isArray(list) ? list : []).slice(0, 3000)) {
      const email = lower(raw.email)
      const hit = email && byEmail.get(email)
      const keep = Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)))
      if (hit) {
        Object.assign(hit, cleanContact({ ...keep, sources: [source] }, hit))
        merged++
      } else {
        const c = cleanContact({ ...keep, sources: [source] })
        if (!c.name || (!c.email && !c.mobile)) continue
        all.push(c); if (c.email) byEmail.set(c.email, c); added++
      }
    }
    await writeJson(CONTACTS, all)
    return { added, merged, total: all.length }
  })
}

/** Mobiles from a phone's contacts, only onto people already in the list. */
export async function applyPhoneMobiles(updates) {
  return withLock(CONTACTS, async () => {
    const all = await readJson(CONTACTS, [])
    const byId = new Map(all.map(c => [c.id, c]))
    let filled = 0
    for (const u of (updates || []).slice(0, 3000)) {
      const c = byId.get(u.id)
      if (!c || c.mobile || !isMobile(u.mobile)) continue
      c.mobile = normaliseMobile(u.mobile)
      c.sources = [...new Set([...(c.sources || []), 'phone'])]
      filled++
    }
    await writeJson(CONTACTS, all)
    return { filled }
  })
}

async function markOptedOut(email, mobile, how) {
  await withLock(CONTACTS, async () => {
    const all = await readJson(CONTACTS, [])
    for (const c of all) {
      if ((email && c.email === lower(email)) || (mobile && c.mobile && c.mobile === normaliseMobile(mobile))) {
        c.optedOut = { at: new Date().toISOString(), how }
      }
    }
    await writeJson(CONTACTS, all)
  })
}

// ─── Events ──────────────────────────────────────────────────────────────────

const summary = e => ({
  id: e.id, title: e.title, kind: e.kind, start: e.start, venue: e.venue,
  organisers: e.organisers, createdBy: e.createdBy, ...(({ invited, yes, seats, capacity }) => ({ invited, yes, seats, capacity }))(summarise(e))
})

async function writeEvent(event) {
  await writeJson(eventKey(event.id), event)
  const index = (await readJson(INDEX, [])).filter(e => e.id !== event.id)
  if (!event.deleted) index.push(summary(event))
  index.sort((a, b) => String(b.start).localeCompare(String(a.start)))
  await writeJson(INDEX, index)
}

export async function getEvent(id) {
  return readJson(eventKey(String(id || '').replace(/[^\w-]/g, '')), null)
}

export async function listEvents(session) {
  const index = await readJson(INDEX, [])
  return index.filter(e => mayOrganise(session, e))
}

function cleanEventFields(input, old = {}) {
  const iso = v => { const d = new Date(v); return v && !Number.isNaN(d.getTime()) ? d.toISOString() : '' }
  const kind = EVENT_KINDS.some(k => k.id === input.kind) ? input.kind : (old.kind || 'dinner')
  return {
    title: clip(input.title ?? old.title, 120) || 'Untitled event',
    kind,
    start: iso(input.start ?? old.start),
    end: iso(input.end ?? old.end),
    venue: clip(input.venue ?? old.venue, 120),
    address: clip(input.address ?? old.address, 200),
    mapUrl: /^https:\/\//.test(String(input.mapUrl ?? old.mapUrl ?? '')) ? clip(input.mapUrl ?? old.mapUrl, 400) : '',
    dress: clip(input.dress ?? old.dress, 80),
    details: String(input.details ?? old.details ?? '').slice(0, 3000),
    message: String(input.message ?? old.message ?? '').slice(0, 1200),
    replyBy: iso(input.replyBy ?? old.replyBy),
    capacity: Math.max(0, Math.min(2000, Number(input.capacity ?? old.capacity) || 0)),
    hostLine: clip(input.hostLine ?? old.hostLine, 120),
    organisers: [...new Set((input.organisers ?? old.organisers ?? [])
      .map(lower).filter(e => STAFF.some(s => lower(s.email) === e)))],
    form: input.form ? cleanForm(input.form) : (old.form || defaultForm(kind)),
    cost: {
      total: Math.max(0, Number(input.cost?.total ?? old.cost?.total) || 0),
      sharedWith: clip(input.cost?.sharedWith ?? old.cost?.sharedWith, 80),
      ourShare: Math.max(0, Math.min(100, Number(input.cost?.ourShare ?? old.cost?.ourShare ?? 100))),
      note: clip(input.cost?.note ?? old.cost?.note, 300)
    }
  }
}

export async function saveEvent(input, session) {
  if (input.id) {
    return withLock(eventKey(input.id), async () => {
      const old = await getEvent(input.id)
      if (!old || old.deleted) throw Object.assign(new Error('That event is gone'), { status: 404 })
      if (!mayOrganise(session, old)) throw Object.assign(new Error('Not an organiser of this event'), { status: 403 })
      const next = { ...old, ...cleanEventFields(input, old), updatedAt: new Date().toISOString(), updatedBy: session.email }
      // Admins and the creator decide who organises; an added organiser cannot remove the creator.
      if (!next.organisers.includes(lower(old.createdBy))) next.organisers.unshift(lower(old.createdBy))
      await writeEvent(next)
      return next
    })
  }
  if (!isAdmin(session.email)) throw Object.assign(new Error('Only an admin can start a new event'), { status: 403 })
  const id = randomUUID().slice(0, 12)
  const event = {
    id, ...cleanEventFields(input), createdBy: lower(session.email), createdAt: new Date().toISOString(),
    guests: [], invite: null
  }
  if (!event.organisers.includes(event.createdBy)) event.organisers.unshift(event.createdBy)
  await writeEvent(event)
  return event
}

export async function deleteEvent(id, session) {
  return withLock(eventKey(id), async () => {
    const event = await getEvent(id)
    if (!event) return { removed: true }
    if (!isAdmin(session.email)) throw Object.assign(new Error('Only an admin can delete an event'), { status: 403 })
    for (const g of event.guests || []) await redis('del', `rsvp:${g.token}`).catch(() => {})
    await writeEvent({ ...event, deleted: true })
    await redis('del', eventKey(id))
    return { removed: true }
  })
}

/** Change one event under its lock, as an organiser. */
async function changeEvent(id, session, fn) {
  return withLock(eventKey(id), async () => {
    const event = await getEvent(id)
    if (!event || event.deleted) throw Object.assign(new Error('That event is gone'), { status: 404 })
    if (session && !mayOrganise(session, event)) throw Object.assign(new Error('Not an organiser of this event'), { status: 403 })
    const out = await fn(event)
    await writeEvent(event)
    return out ?? event
  })
}

const newToken = () => randomBytes(16).toString('base64url')

export async function addGuests(id, { contactIds = [], people = [] }, session) {
  const contacts = await listContacts()
  const byId = new Map(contacts.map(c => [c.id, c]))
  return changeEvent(id, session, async event => {
    const have = new Set(event.guests.map(g => g.contactId).filter(Boolean))
    const haveEmail = new Set(event.guests.map(g => g.email).filter(Boolean))
    let added = 0
    const add = async src => {
      const g = {
        token: newToken(), contactId: src.id || null, name: clip(src.name, 100), email: lower(src.email),
        mobile: normaliseMobile(src.mobile), group: src.group || 'Other', status: 'none', answers: {},
        sent: {}, addedBy: session.email, addedAt: new Date().toISOString()
      }
      if (!g.name) return
      await redis('set', `rsvp:${g.token}`, event.id)
      event.guests.push(g); added++
    }
    for (const cid of contactIds) {
      const c = byId.get(cid)
      if (!c || have.has(cid) || (c.email && haveEmail.has(c.email))) continue
      await add(c); have.add(cid)
    }
    for (const p of people.slice(0, 50)) {
      if (p.email && haveEmail.has(lower(p.email))) continue
      await add({ ...p, group: GROUPS.includes(p.group) ? p.group : 'Other' })
    }
    return { added, event }
  })
}

export async function updateGuest(id, token, change, session) {
  return changeEvent(id, session, async event => {
    const g = event.guests.find(x => x.token === token)
    if (!g) throw Object.assign(new Error('Guest not found'), { status: 404 })
    if (change.remove) {
      event.guests = event.guests.filter(x => x !== g)
      await redis('del', `rsvp:${token}`)
      return event
    }
    if (['yes', 'maybe', 'no', 'none', 'waitlist'].includes(change.status)) { g.status = change.status; g.setBy = session.email }
    if ('checkedIn' in change) g.checkedIn = change.checkedIn ? new Date().toISOString() : null
    if (change.answers) g.answers = cleanAnswers(event.form, change.answers)
    return event
  })
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export const guestUrl = token => `${PORTAL_URL}/e/${token}`
const stopUrl = token => `${PORTAL_URL}/e/${token}?stop=1`

function firstName(name) {
  const parts = String(name || '').replace(/^(dr|prof|mr|mrs|ms|miss)\.?\s+/i, '').split(/\s+/)
  return /^dr\b/i.test(name) ? `Dr ${parts.slice(-1)[0]}` : parts[0]
}

export function invitationEmail(event, guest, sender, { reminder = false } = {}) {
  const when = whenText(event.start)
  const replyBy = event.replyBy ? whenText(event.replyBy).split(' · ')[0] : ''
  const lead = reminder
    ? (guest.status === 'yes'
      ? `A reminder that ${event.title} is coming up — we look forward to seeing you.`
      : `We'd love to know whether you can make ${event.title}${replyBy ? ` — please reply by ${replyBy}` : ''}.`)
    : (event.message || `You're invited to ${event.title}.`)
  const rows = [['When', when], ['Where', [event.venue, event.address].filter(Boolean).join(', ')],
    ['Dress', event.dress], ['Reply by', replyBy]].filter(r => r[1])
  const sig = personSignoff(sender)
  const html = emailShell({
    label: reminder ? 'Reminder' : 'Invitation',
    body: [
      para(`Hi ${firstName(guest.name)},`),
      para(lead),
      factsPanel(rows),
      button(guest.status === 'yes' && reminder ? 'See the details' : 'See the invitation and reply', guestUrl(guest.token)),
      signoff({ closing: 'Kind regards,', ...sig }),
      aside(`Don't want TechnoMed event invitations? Unsubscribe: ${stopUrl(guest.token)}`)
    ].join('\n')
  })
  const text = [`Hi ${firstName(guest.name)},`, '', lead, '', factsText(rows), '',
    `See the invitation and reply: ${guestUrl(guest.token)}`, '', 'Kind regards,', sig.name, sig.role, '',
    `Unsubscribe from TechnoMed event invitations: ${stopUrl(guest.token)}`].filter(l => l != null).join('\n')
  const subject = reminder ? `Reminder: ${event.title}` : `Invitation: ${event.title} — ${when}`
  return { subject, html, text }
}

export function invitationSms(event, guest, { reminder = false } = {}) {
  const when = whenText(event.start)
  const head = reminder
    ? (guest.status === 'yes' ? `Reminder: ${event.title}, ${when}.` : `Can you make ${event.title} (${when})? Please reply:`)
    : `${firstName(guest.name)}, TechnoMed invites you to ${event.title}, ${when}. See the invite and reply:`
  return `${head} ${guestUrl(guest.token)} Reply STOP to opt out`
}

/**
 * Send (or remind) by email and/or SMS. `who`: 'unsent' | 'noreply' | 'coming'
 * | a list of tokens. Opted-out contacts are skipped and said so.
 */
export async function sendToGuests(id, { via = ['email'], who = 'unsent', reminder = false }, session) {
  const event = await getEvent(id)
  if (!event || event.deleted) throw Object.assign(new Error('That event is gone'), { status: 404 })
  if (!mayOrganise(session, event)) throw Object.assign(new Error('Not an organiser of this event'), { status: 403 })
  const contacts = await listContacts()
  const optedOut = new Set(contacts.filter(c => c.optedOut).flatMap(c => [c.email, c.mobile]).filter(Boolean))
  const chosen = event.guests.filter(g => Array.isArray(who) ? who.includes(g.token)
    : who === 'unsent' ? !g.sent?.email && !g.sent?.sms
      : who === 'noreply' ? (g.status || 'none') === 'none'
        : who === 'coming' ? g.status === 'yes' : false)
  const sender = { email: session.email, name: staffName(session.email) }
  const smsReady = clicksendConfigured()
  const results = []
  for (const g of chosen) {
    const r = { token: g.token, name: g.name }
    if ((g.email && optedOut.has(g.email)) || (g.mobile && optedOut.has(g.mobile))) { r.skipped = 'opted out'; results.push(r); continue }
    if (via.includes('email') && g.email) {
      try {
        const m = invitationEmail(event, g, sender, { reminder })
        await sendEventEmail({ to: [g.email], ...m, sender, label: `${reminder ? 'Event reminder' : 'Event invitation'} · ${event.title}` })
        r.email = 'sent'
      } catch (err) { r.email = 'failed'; r.emailError = err.message }
    }
    if (via.includes('sms') && g.mobile) {
      if (!smsReady) r.sms = 'not set up'
      else {
        try { await sendClickSendSms(g.mobile, invitationSms(event, g, { reminder })); r.sms = 'sent' } catch (err) { r.sms = 'failed'; r.smsError = err.message }
      }
    }
    results.push(r)
  }
  // Recorded under the lock, against the event as it is now.
  await changeEvent(id, null, async fresh => {
    const at = new Date().toISOString()
    for (const r of results) {
      const g = fresh.guests.find(x => x.token === r.token)
      if (!g) continue
      g.sent = { ...(g.sent || {}) }
      const key = reminder ? 'reminded' : 'invited'
      if (r.email === 'sent') g.sent.email = g.sent.email || at
      if (r.sms === 'sent') g.sent.sms = g.sent.sms || at
      if (r.email === 'sent' || r.sms === 'sent') g.sent[key] = at
      if (r.emailError || r.smsError) g.sent.error = r.emailError || r.smsError
    }
  })
  return { results, smsReady }
}

// ─── The invite file ─────────────────────────────────────────────────────────

const INVITE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }

export async function saveInvite(id, { base64, contentType }, session) {
  const ext = INVITE_TYPES[contentType]
  if (!ext) throw Object.assign(new Error('Upload a JPEG, PNG, WebP or PDF'), { status: 400 })
  const buffer = Buffer.from(String(base64 || ''), 'base64')
  if (!buffer.length || buffer.length > 3 * 1024 * 1024) throw Object.assign(new Error('The invite must be under 3 MB — save the PDF smaller or upload a picture'), { status: 400 })
  const event = await getEvent(id)
  if (!event || !mayOrganise(session, event)) throw Object.assign(new Error('Not an organiser of this event'), { status: 403 })
  const folder = `/Admin/Events/${event.id}`
  await ensureFolder(folder).catch(() => {})
  const path = `${folder}/invite-${Date.now()}.${ext}`
  await uploadFile(path, buffer)
  return changeEvent(id, session, async e => {
    e.invite = { path, kind: ext === 'pdf' ? 'pdf' : 'image', at: new Date().toISOString(), by: session.email }
    return e
  })
}

// ─── The guest's side (no session) ───────────────────────────────────────────

async function eventForToken(token) {
  if (!/^[\w-]{16,40}$/.test(String(token || ''))) return {}
  const id = await redis('get', `rsvp:${token}`)
  if (!id) return {}
  const event = await getEvent(id)
  const guest = event?.guests?.find(g => g.token === token)
  return event && guest && !event.deleted ? { event, guest } : {}
}

const replyOpen = event => !event.start || new Date(event.start).getTime() > Date.now()

export function publicView(event, guest) {
  const s = summarise(event)
  return {
    event: {
      title: event.title, kind: event.kind, start: event.start, end: event.end, venue: event.venue,
      address: event.address, mapUrl: event.mapUrl, dress: event.dress, details: event.details,
      replyBy: event.replyBy, hostLine: event.hostLine || 'Hosted by TechnoMed',
      form: cleanForm(event.form), invite: event.invite ? { kind: event.invite.kind } : null,
      placesLeft: s.capacity ? s.left : null, open: replyOpen(event)
    },
    guest: { name: guest.name, status: guest.status || 'none', answers: guest.answers || {}, checkedIn: Boolean(guest.checkedIn) }
  }
}

export async function guestView(token) {
  const { event, guest } = await eventForToken(token)
  if (!event) return null
  // Counted once per guest, for the organiser's "opened" column.
  if (!guest.opened) {
    await changeEvent(event.id, null, async e => {
      const g = e.guests.find(x => x.token === token)
      if (g && !g.opened) g.opened = new Date().toISOString()
    }).catch(() => {})
  }
  return publicView(event, guest)
}

export async function guestReply(token, { status, answers }) {
  const { event } = await eventForToken(token)
  if (!event) return null
  if (!replyOpen(event)) throw Object.assign(new Error('Replies have closed for this event'), { status: 409 })
  if (!['yes', 'maybe', 'no'].includes(status)) throw Object.assign(new Error('Choose Yes, Maybe or No'), { status: 400 })
  return changeEvent(event.id, null, async e => {
    const g = e.guests.find(x => x.token === token)
    if (!g) throw Object.assign(new Error('This invitation is no longer open'), { status: 404 })
    g.answers = status === 'no' ? {} : cleanAnswers(e.form, answers)
    g.repliedAt = new Date().toISOString()
    g.status = status
    if (status === 'yes' && e.capacity) {
      const others = e.guests.filter(x => x !== g).reduce((n, x) => n + seatsFor(x), 0)
      if (others + seatsFor(g) > e.capacity) g.status = 'waitlist'
    }
    return publicView(e, g)
  })
}

export async function guestStop(token) {
  const { guest } = await eventForToken(token)
  if (!guest) return null
  await markOptedOut(guest.email, guest.mobile, 'unsubscribe link')
  return { stopped: true }
}

export async function guestInviteLink(token) {
  const { event } = await eventForToken(token)
  if (!event?.invite?.path) return null
  return (await temporaryLink(event.invite.path)).url
}

export async function guestCalendar(token) {
  const { event } = await eventForToken(token)
  return event ? icsFor(event, guestUrl(token)) : null
}

/** An SMS "STOP" reply from ClickSend's inbound hook (when it is set up). */
export async function smsStop(from) {
  await markOptedOut('', from, 'replied STOP')
}

// ─── The venue sheet and the hospitality record ─────────────────────────────

export function venueCsv(event) {
  const form = cleanForm(event.form)
  const head = ['Name', 'Group', 'Reply', 'Seats', ...form.map(q => q.label), 'Checked in']
  const rows = event.guests.map(g => [g.name, g.group, g.status || 'none', seatsFor(g),
    ...form.map(q => {
      const a = g.answers?.[q.id]
      if (a == null) return ''
      if (q.type === 'chips') return a.join('; ')
      if (q.type === 'plus') return a.coming ? `${a.name || 'Partner'}${a.diet ? ` (${a.diet})` : ''}` : ''
      return typeof a === 'object' ? [a.pick, a.note].filter(Boolean).join(' — ') : a
    }), g.checkedIn ? 'yes' : ''])
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n')
}

export function hospitalityCsv(event) {
  const s = summarise(event)
  const share = (event.cost?.ourShare ?? 100) / 100
  const seats = s.seats || 1
  const perHead = event.cost?.total ? (event.cost.total * share) / seats : 0
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [
    ['Event', event.title], ['Date', whenText(event.start)], ['Venue', [event.venue, event.address].filter(Boolean).join(', ')],
    ['Total cost (AUD)', event.cost?.total || ''], ['Shared with', event.cost?.sharedWith || ''],
    ['TechnoMed share (%)', event.cost?.ourShare ?? 100], ['Seats', s.seats],
    ['TechnoMed cost per head (AUD)', perHead ? perHead.toFixed(2) : ''], ['Note', event.cost?.note || ''], [],
    ['Attendee', 'Group', 'Healthcare professional', 'Checked in']
  ]
  for (const g of event.guests.filter(x => x.status === 'yes')) {
    lines.push([g.name, g.group, ['Surgeon', 'Registrar/Fellow', 'Theatre/Nursing'].includes(g.group) ? 'yes' : 'no', g.checkedIn ? 'yes' : ''])
  }
  return lines.map(r => r.map(cell).join(',')).join('\r\n')
}
