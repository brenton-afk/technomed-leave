// ─── What is in situ, looked up (Brent, 17 Nov 2026) ─────────────────────────
// A booking that says extension, revision, removal, connection to an existing
// construct … (inSituReason in src/clinicalPlan/priorImplants.js) used only to
// get an "In situ?" tag. Now the earlier usages under that surname are found
// and read, and the answer is one sentence (inSituAnswer in
// src/clinicalPlan/inSituSummary.js):
//
//   • the portal's own usage records — every usage sent through the portal,
//     items and all, read straight away;
//   • the Dropbox usage tree — searched by surname, but only once the usage
//     folders are unlocked (DROPBOX_USAGE_READS=on, after the redaction). Until
//     then a case with nothing in the portal says Dropbox was not searched,
//     rather than "no usage in Dropbox", which would be untrue.
//
// The rep confirms the answer on the booking (same patient / not this patient
// / checked, nothing found), and seven days before the case the team leader on
// shift that day is emailed it (inSituAlerts, from the morning cron), once.
//
// Matched on the surname alone — all the portal keeps — so the answer is about
// a record, and the rep confirms it is this patient. The alert email names the
// surgeon, operation, hospital and day, never the patient, like the other
// staff reminders.

import { redis, redisSetBody, getUsageRecordsBulk } from './_redis.js'
import { dropboxConfigured, usageReadsAllowed, searchUsage } from './_dropbox.js'
import { readFiledCase, priorImplantsFor } from '../src/clinicalPlan/priorImplants.js'
import { priorUsages, inSituAnswer, CONFIRM_ANSWERS } from '../src/clinicalPlan/inSituSummary.js'

const KEY = id => `insitu:${id}`
const OK = id => `insitu:ok:${id}`
const ALERTED = id => `insitu:alerted:${id}`
const KEEP_SECONDS = 60 * 24 * 3600
// A looked-up answer is reused for half a day: a usage filed meanwhile, or the
// Dropbox lock lifted, shows by the next morning.
const FRESH_MS = 12 * 3600 * 1000
const RECORDS = 600

const sameKey = c => `${String(c.patient || '').trim().toLowerCase()}|${c.date || ''}`

/** Earlier Dropbox case folders for this surname, before the case — only when unlocked. */
async function dropboxPrior({ patient, surgeon, date }) {
  if (!dropboxConfigured() || !usageReadsAllowed()) return { checked: false, cases: [] }
  const found = await searchUsage(patient)
  const filed = found.map(f => readFiledCase(f.name, f.path)).filter(Boolean)
  const cases = priorImplantsFor(filed, patient, surgeon)
    .filter(c => !date || !c.date || c.date < date)
  return { checked: true, cases }
}

/** Looks one case up, stores the answer, and returns it. */
export async function lookupInSitu(c, { records } = {}) {
  const all = records || await getUsageRecordsBulk(RECORDS)
  const portal = priorUsages(all, { patient: c.patient, before: c.date })
  let dropbox = { checked: false, cases: [] }
  let dropboxError = ''
  try {
    dropbox = await dropboxPrior(c)
  } catch (err) {
    dropboxError = err.message
  }
  // A usage sent through the portal is also filed in Dropbox: one case, once.
  const portalDays = new Set(portal.map(r => r.date))
  const dropboxOnly = dropbox.cases.filter(d => !d.date || !portalDays.has(d.date))
  const answer = inSituAnswer({ portal, dropbox: dropboxOnly, dropboxChecked: dropbox.checked })
  const result = {
    ...answer,
    key: sameKey(c),
    reason: c.inSitu || '',
    dropboxChecked: dropbox.checked,
    ...(dropboxError ? { dropboxError } : {}),
    checkedAt: new Date().toISOString()
  }
  await redisSetBody(KEY(c.id), JSON.stringify(result))
  await redis('expire', KEY(c.id), String(KEEP_SECONDS)).catch(() => {})
  return result
}

/**
 * The answer for each case, with the rep's confirmation: stored answers in one
 * round trip, and up to `compute` missing or stale ones looked up now.
 *
 * @param {Array<{id, patient, surgeon, date}>} cases
 */
export async function inSituFor(cases, { compute = 3 } = {}) {
  const list = (cases || []).filter(c => c?.id && c.patient)
  if (!list.length) return {}
  const raws = await redis('mget', ...list.flatMap(c => [KEY(c.id), OK(c.id)])) || []
  const out = {}
  const todo = []
  list.forEach((c, i) => {
    let stored = null
    let ok = null
    try { stored = raws[i * 2] ? JSON.parse(raws[i * 2]) : null } catch { stored = null }
    try { ok = raws[i * 2 + 1] ? JSON.parse(raws[i * 2 + 1]) : null } catch { ok = null }
    // A confirmation counts only for the patient and day it was made against.
    const confirmed = ok && ok.key === sameKey(c) ? ok : null
    const fresh = stored && stored.key === sameKey(c)
      && Date.now() - Date.parse(stored.checkedAt || 0) < FRESH_MS
    if (fresh) out[c.id] = { ...stored, confirmed }
    else todo.push({ c, confirmed, stale: stored && stored.key === sameKey(c) ? stored : null })
  })
  let records = null
  for (const { c, confirmed, stale } of todo.slice(0, compute)) {
    try {
      records = records || await getUsageRecordsBulk(RECORDS)
      out[c.id] = { ...(await lookupInSitu(c, { records })), confirmed }
    } catch (err) {
      out[c.id] = stale ? { ...stale, confirmed } : { status: 'error', sentence: 'Could not look this up just now.', confirmed }
      console.error('in situ lookup failed:', err.message)
    }
  }
  // The rest are said to be on their way, and come with the next refresh.
  for (const { c, confirmed, stale } of todo.slice(compute)) {
    out[c.id] = stale ? { ...stale, confirmed } : { status: 'pending', sentence: 'Looking for earlier usages…', confirmed }
  }
  return out
}

/** The rep's answer on the booking: same patient, not this patient, or checked and nothing found. */
export async function confirmInSitu(c, answer, session) {
  if (answer === 'clear') {
    await redis('del', OK(c.id))
    return null
  }
  if (!CONFIRM_ANSWERS[answer]) throw Object.assign(new Error('Unknown answer'), { status: 400 })
  const ok = { answer, key: sameKey(c), by: session?.name || session?.email || '', at: new Date().toISOString() }
  await redisSetBody(OK(c.id), JSON.stringify(ok))
  await redis('expire', OK(c.id), String(KEEP_SECONDS)).catch(() => {})
  return ok
}

/**
 * Seven days before each in-situ case, the answer to the team leader on shift
 * today — once per case. Dependencies are passed in so the cron and the tests
 * share it.
 */
export async function inSituAlerts({ today, addDays, casesOn, leaderEmailOn, send }) {
  const day = addDays(today, 7)
  const cases = (await casesOn(day))
    .filter(c => c.inSitu && !c.cancelled && !c.notRequired)
  if (!cases.length) return { day, alerted: 0 }
  const leader = await leaderEmailOn(today)
  if (!leader) return { day, alerted: 0, skipped: 'no team leader on shift today' }
  const answers = await inSituFor(cases, { compute: cases.length })
  const sent = []
  const failed = []
  for (const c of cases) {
    const claimed = await redis('set', ALERTED(c.id), new Date().toISOString(), 'NX', 'EX', String(KEEP_SECONDS))
    if (claimed !== 'OK') continue
    try {
      await send({ to: leader, case: c, answer: answers[c.id] || {} })
      sent.push(c.id)
    } catch (err) {
      await redis('del', ALERTED(c.id)).catch(() => {})
      failed.push({ id: c.id, error: err.message })
    }
  }
  return { day, alerted: sent.length, to: leader, ...(failed.length ? { failed } : {}) }
}
