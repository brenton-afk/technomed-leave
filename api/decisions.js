import { requireSession } from './_auth.js'
import { redis } from './_redis.js'
import {
  mayUseDecisions, decisionMailboxes, readInboxReviews, refreshInboxes, STALE_MINUTES, mergeDuplicateEmails, openMerged,
  usageItems, resupplyItems, bookingInboxItems, readStates, markItem, openItems, ranked, OWNERS
} from './_decisions.js'

// ─── Decisions (trial) ───────────────────────────────────────────────────────
// See api/_decisions.js. Everyone not on DECISIONS_USERS (Brent alone, until
// he says otherwise) gets a plain 404, the same as a route that is not there,
// so nothing appears for them and nothing about it is confirmed.

function notFound(res) {
  return res.status(404).json({ error: 'Not found' })
}

async function build(session) {
  const mailboxes = decisionMailboxes()
  const sources = [
    ['usage', 'Usage not sent', () => usageItems()],
    ['resupply', 'Resupply owed', () => resupplyItems()],
    ['bookings', 'Bookings Inbox', () => bookingInboxItems()]
  ]
  const [reviews, states, ...results] = await Promise.all([
    readInboxReviews(mailboxes),
    readStates(session.email).catch(() => ({})),
    ...sources.map(([, , fn]) => fn().then(items => ({ items }), err => ({ items: [], error: err.message })))
  ])
  const all = [...reviews.flatMap(r => r.items || []), ...results.flatMap(r => r.items)]
  const items = ranked(openMerged(mergeDuplicateEmails(all, mailboxes), states))
  const oldest = reviews.reduce((min, r) => Math.min(min, r.at ? Date.parse(r.at) : 0), Infinity)
  return {
    items,
    owners: OWNERS,
    cleared: all.length - items.length,
    mailboxes: reviews.map(r => ({
      address: r.address, owner: r.owner, at: r.at || null, error: r.error || null,
      waiting: (r.items || []).length
    })),
    sources: sources.map(([key, label], i) => ({ key, label, error: results[i].error || null })),
    stale: !Number.isFinite(oldest) || oldest === 0 || Date.now() - oldest > STALE_MINUTES * 60000
  }
}

export default async function handler(req, res) {
  const session = await requireSession(req, res)
  if (!session) return
  if (!mayUseDecisions(session.email)) return notFound(res)
  const action = String(req.query.action || 'list')

  try {
    if (action === 'access') return res.status(200).json({ ok: true })

    if (action === 'list') return res.status(200).json(await build(session))

    if (action === 'refresh') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
      const claimed = await redis('set', 'decisions:refresh:lock', '1', 'NX', 'EX', '150')
      if (claimed === 'OK') {
        try { await refreshInboxes() } finally { await redis('del', 'decisions:refresh:lock').catch(() => {}) }
      }
      return res.status(200).json({ ...(await build(session)), alreadyRunning: claimed !== 'OK' })
    }

    if (action === 'mark') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
      const { id, ids, state, reason, item } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Nothing chosen' })
      // Every copy of a merged email, so the one in the other inbox does not
      // come back on its own. Logged once.
      const others = (Array.isArray(ids) ? ids : []).map(String).filter(x => x && x !== String(id)).slice(0, 10)
      const entry = await markItem(session.email, session.name, { id: String(id), state, reason, item: item || {} })
      for (const other of others) await markItem(session.email, session.name, { id: other, state, reason: '', item: {} })
      return res.status(200).json({ ok: true, entry })
    }

    return notFound(res)
  } catch (err) {
    console.error('decisions failed:', err.message)
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Decisions could not be loaded — try again shortly.' })
  }
}
