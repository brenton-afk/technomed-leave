import React, { useEffect, useState } from 'react'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import { offerNotices } from '../../notices.js'
import { returnTo } from '../../clinicalPlan/turnAround.js'

// ─── What happens to the kit after this case (Brent, 21 Nov 2026) ───────────
// On the usage Done screen and in Edit booking. For each loan kit the portal
// looks ahead at the bookings: another case wants it → "Are you holding onto
// the kit for pt …?", and Yes drafts the email asking the hospital's loans
// team (Sharon at Calvary, Katelin at RHH) to hold it and turn it around;
// wanted the same or next day → "Put priority tags on the trays". Nothing
// wants it → "What's happening with the kit after the case?": a distributor's
// set goes back to the distributor, a TechnoMed loan set back to the office.
// Emails go through the ordinary notice sheet, so a person sees and sends them.

const day = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')
const when = d => {
  const iso = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Hobart' })
  return d === iso ? 'today' : day(d)
}

export default function KitAfterCase({ user, id = '', date = '', surname = '', title = 'After this case — the kits' }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notHolding, setNotHolding] = useState({})
  const [swapOpen, setSwapOpen] = useState('')
  const [swapped, setSwapped] = useState(null)
  const headers = { Authorization: `Bearer ${user?.token || ''}` }

  async function load() {
    const q = new URLSearchParams({ action: 'kit-after', date, ...(id ? { id } : { surname }) })
    try {
      const res = await fetch(`/api/calendar/today?${q}`, { headers })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not look ahead')
      setData(json)
    } catch (err) { setError(err.message) }
  }
  useEffect(() => { if (date && (id || surname)) load() }, [id, date, surname]) // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(kit, outcome, email) {
    setBusy(`${kit.key}:${outcome}`); setError('')
    try {
      const res = await fetch('/api/calendar/today?action=kit-after', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.case.id, date: data.case.date, key: kit.key, outcome, email })
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'That did not go through')
      if (json.notices?.length) offerNotices({ notices: json.notices })
      setData(d => ({ ...d, kits: d.kits.map(k => (k.key === kit.key ? { ...k, decision: json.decision } : k)) }))
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  // "Which patient was this actually used for?" (Ben, 24 Nov 2026): the
  // two bookings swap that system's set; the question is asked again after.
  async function swap(kit, other) {
    if (!window.confirm(`Swap the ${kit.system} sets? pt ${data.case.patient} gets ${other.supply || 'no supply'} and pt ${other.patient} gets ${kit.supply}. Both bookings are changed.`)) return
    setBusy(`${kit.key}:swap`); setError('')
    try {
      const res = await fetch('/api/calendar/today?action=kit-after', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: data.case.id, date: data.case.date, key: kit.key, swapWith: other.id })
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'The swap did not go through')
      setSwapped(json.swapped); setSwapOpen('')
      await load()
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  if (!data?.kits?.length) return error || swapped ? (
    <div role={error ? 'alert' : undefined} style={{ ...text('caption'), color: error ? colour.danger : colour.accentDeep, fontWeight: 600 }}>
      {error || `✓ Swapped — pt ${data?.case?.patient || ''} now ${swapped.here || 'no supply'}, pt ${swapped.other.patient} now ${swapped.there}.`}
    </div>
  ) : null
  const c = data.case
  const loans = c.hospital && /rhh|royal/i.test(c.hospital) ? 'RHH loans (Katelin)' : 'Calvary loans (Sharon)'
  const btn = on => ({ ...text('caption'), fontWeight: 700, padding: '9px 14px', borderRadius: radius.pill, cursor: 'pointer', ...(on ? face.primary : face.secondary) })

  return (
    <section data-kit-after style={{ background: colour.surface, border: `1.5px solid ${colour.warningLine}`, borderRadius: radius.card, padding: space.md, display: 'flex', flexDirection: 'column', gap: space.md }}>
      <div style={{ ...text('heading'), color: colour.ink }}>{title}</div>
      {data.kits.map(k => {
        const d = k.decision || {}
        const n = k.next
        const holding = d.outcome === 'hold'
        const returned = d.outcome === 'return'
        const askReturn = !n || notHolding[k.key]
        return (
          <div key={k.key} data-kit-after-item={k.key} style={{ display: 'flex', flexDirection: 'column', gap: space.sm, borderTop: border.hairlineSoft, paddingTop: space.sm }}>
            <div style={{ ...text('bodyStrong'), color: colour.ink }}>
              {k.system}
              <span style={{ ...text('caption'), color: colour.inkMuted, fontWeight: 400 }}>
                {' · '}{k.kind === 'distributor' ? `${k.distributorName} loan set` : k.kind === 'tm' ? 'TechnoMed loan set' : k.kind === 'hospital' ? `borrowed from ${k.homeName}` : 'consignment'}
              </span>
            </div>

            {k.others?.length > 0 && (
              swapOpen === k.key ? (
                <div data-kit-swap style={{ display: 'flex', flexDirection: 'column', gap: space.xs, background: colour.canvas, borderRadius: radius.control, padding: space.sm }}>
                  <div style={{ ...text('caption'), color: colour.ink, fontWeight: 600 }}>Which set did pt {c.patient} actually have?</div>
                  {k.others.map(o => (
                    <button key={o.id} data-kit-swap-with={o.id} disabled={Boolean(busy)} onClick={() => swap(k, o)}
                      style={{ ...btn(false), textAlign: 'left' }}>
                      {busy === `${k.key}:swap` ? '…' : `The ${o.supply || 'other'} set — swap with pt ${o.patient}${o.surgeon ? ` (${o.surgeon})` : ''}`}
                    </button>
                  ))}
                  <button onClick={() => setSwapOpen('')} style={{ ...text('caption'), background: 'none', border: 'none', color: colour.inkFaint, cursor: 'pointer', alignSelf: 'flex-start' }}>
                    No — it was the {k.supply}
                  </button>
                </div>
              ) : (
                <button data-kit-swap-open onClick={() => setSwapOpen(k.key)}
                  style={{ ...text('caption'), background: 'none', border: 'none', padding: 0, color: colour.accentDeep, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start', textDecoration: 'underline' }}>
                  Used a different set? {k.others.length === 1 ? `pt ${k.others[0].patient} had the ${k.others[0].supply || 'other'} set` : 'Swap with another case'}
                </button>
              )
            )}

            {n && k.kind !== 'consignment' && !returned && (
              holding ? (
                <div data-kit-holding style={{ ...text('caption'), color: colour.accentDeep, fontWeight: 600 }}>
                  ✓ Holding it for pt {n.patient} · {n.surgeon} · {day(n.date)} — {d.by}
                </div>
              ) : !notHolding[k.key] && (
                <>
                  <div style={{ ...text('body'), color: colour.ink }}>
                    Are you holding onto the kit for <strong>pt {n.patient}</strong>{n.surgeon ? ` (${n.surgeon})` : ''} on {when(n.date)}?
                    {' '}Let {loans} know to hold it and turn it around.
                  </div>
                  <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
                    <button data-kit-hold disabled={Boolean(busy)} onClick={() => decide(k, 'hold', true)} style={btn(true)}>
                      {busy === `${k.key}:hold` ? '…' : 'Yes — hold it and tell them'}
                    </button>
                    <button onClick={() => setNotHolding(s => ({ ...s, [k.key]: true }))} style={btn(false)}>No</button>
                  </div>
                </>
              )
            )}

            {k.priority && n && (
              d.priorityTagged ? (
                <div data-kit-priority-done style={{ ...text('caption'), color: colour.accentDeep, fontWeight: 600 }}>✓ Priority tags on — {d.priorityTagged.by}</div>
              ) : (
                <div data-kit-priority style={{ display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap', background: colour.warningSoft, borderRadius: radius.control, padding: `${space.sm}px ${space.md}px` }}>
                  <span style={{ flex: 1, minWidth: 160, ...text('body'), color: colour.ink }}>
                    Needed again {when(n.date) === 'today' ? 'later today' : `on ${when(n.date)}`} for pt {n.patient} — <strong>put priority tags on the trays.</strong>
                  </span>
                  <button disabled={Boolean(busy)} onClick={() => decide(k, 'priority', false)} style={btn(true)}>
                    {busy === `${k.key}:priority` ? '…' : 'Priority tags on'}
                  </button>
                </div>
              )
            )}

            {k.kind !== 'consignment' && askReturn && !holding && (
              returned ? (
                <div data-kit-returned style={{ ...text('caption'), color: colour.accentDeep, fontWeight: 600 }}>✓ Going back to {returnTo(k)} — {d.by}</div>
              ) : (
                <>
                  <div style={{ ...text('body'), color: colour.ink }}>
                    {n ? 'Then what' : 'What'}’s happening with the kit after the case?
                    {k.kind === 'distributor' ? ` A distributor's loan set goes back to ${k.distributorName}.` : k.kind === 'tm' ? ' It comes back to the office.' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
                    <button data-kit-return disabled={Boolean(busy)} onClick={() => decide(k, 'return', true)} style={btn(true)}>
                      {busy === `${k.key}:return` ? '…' : `Back to ${returnTo(k)} — tell ${loans.split(' (')[0]}`}
                    </button>
                    <button disabled={Boolean(busy)} onClick={() => decide(k, 'return', false)} style={btn(false)}>Back to {returnTo(k)}, no email</button>
                  </div>
                </>
              )
            )}
          </div>
        )
      })}
      {swapped && <div data-kit-swapped style={{ ...text('caption'), color: colour.accentDeep, fontWeight: 600 }}>✓ Swapped — pt {c.patient} now {swapped.here || 'no supply'}, pt {swapped.other.patient} now {swapped.there}.</div>}
      {error && <div role="alert" style={{ ...text('caption'), color: colour.danger }}>{error}</div>}
      <div style={{ ...text('caption'), color: colour.inkFaint }}>Emails open for you to check before they send. Looks {28} days ahead at {c.hospital || 'this hospital'}.</div>
    </section>
  )
}
