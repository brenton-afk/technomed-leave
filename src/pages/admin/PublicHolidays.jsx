import React, { useCallback, useEffect, useMemo, useState } from 'react'

// ─── Public holidays, in the admin portal ────────────────────────────────────
// The sync runs nightly and nobody watches it, which is the point. This card is
// for the two questions somebody actually asks about it: what is coming, and
// did it work.
//
// It calls the same endpoint the cron does. On a preview deployment that
// endpoint refuses to write and answers with what it *would* have written, so
// pressing the button here is safe to do and still tells you whether the dates
// are right — which is most of what you want before merging.

const NAVY = '#042746'
const TEAL = '#189a85'
const MUTED = '#6b7a8d'
const BORDER = 'rgba(26,43,74,0.12)'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 2026-02-09 → Mon 9 Feb 2026. */
function readable(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  return `${day} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

export default function PublicHolidays({ user }) {
  // Keyed on the token, not the user object. A parent that rebuilds `user`
  // on every render would otherwise rebuild the headers, which rebuilds the
  // loader, which re-fires the effect that sets state — a loop that shows up
  // as a slow page rather than as an error.
  const token = user?.token || ''
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  /**
   * What is coming, without writing anything.
   *
   * GET rather than POST, so opening the card cannot put entries on a shared
   * calendar as a side effect of looking.
   */
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/cron/sync-public-holidays?preview=1',
        { headers: authHeaders })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [authHeaders])

  useEffect(() => { load() }, [load])

  async function syncNow() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/cron/sync-public-holidays', {
        method: 'POST',
        headers: authHeaders
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const upcoming = (result?.holidays || [])
    .filter(h => h.date >= new Date().toISOString().slice(0, 10))
    .slice(0, 12)

  return (
    <div style={{
      background: 'white', borderRadius: 12, border: `1px solid ${BORDER}`,
      marginBottom: 16, overflow: 'hidden'
    }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Public holidays</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
          Hobart. Added to the bookings calendar nightly, this year and next.
        </div>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {loading && <div style={{ fontSize: 13, color: MUTED }}>Checking…</div>}

        {error && (
          <div style={{
            background: '#fdecea', color: '#c0392b', padding: '10px 12px',
            borderRadius: 8, fontSize: 13, marginBottom: 10
          }}>{error}</div>
        )}

        {/* Which source answered. Worth showing rather than logging: the
            national dataset is inactive and ends at 2025, so this reads
            "checked-in file" — and the day it stops doing that is the day the
            dates stop being ones we worked out ourselves. */}
        {(result?.sources || []).map(s => (
          <div key={s.year} style={{ fontSize: 12.5, color: MUTED, marginBottom: 4 }}>
            <strong style={{ color: NAVY }}>{s.year}</strong> — from the {s.source}
            {s.apiError ? ` (data.gov.au: ${s.apiError})` : ''}
          </div>
        ))}

        {result?.dryRun && (
          <div style={{
            background: '#fff3cd', color: '#856404', padding: '10px 12px',
            borderRadius: 8, fontSize: 12.5, margin: '10px 0'
          }}>
            {result.reason || 'Nothing was written to the calendar.'}
          </div>
        )}

        {result?.ran && (
          <div style={{ fontSize: 12.5, color: MUTED, margin: '10px 0' }}>
            {result.created.length} added, {result.updated.length} already there
            {result.failed?.length ? `, ${result.failed.length} failed` : ''}
            {result.colour && !result.colour.matchedExisting
              ? ' · no existing public holidays found to match, so Tomato was used'
              : ''}
          </div>
        )}

        {upcoming.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
            {upcoming.map(h => (
              <li key={h.date} style={{
                display: 'flex', gap: 10, padding: '6px 0',
                borderTop: `1px solid ${BORDER}`, fontSize: 13
              }}>
                <span style={{ color: MUTED, minWidth: 118 }}>{readable(h.date)}</span>
                <span style={{ color: NAVY, fontWeight: 600 }}>{h.name}</span>
              </li>
            ))}
          </ul>
        )}

        {!loading && !upcoming.length && !error && (
          <div style={{ fontSize: 13, color: MUTED }}>Nothing upcoming.</div>
        )}
      </div>

      <div style={{ padding: '12px 16px', borderTop: `1px solid ${BORDER}` }}>
        <button onClick={syncNow} disabled={busy}
          style={{
            width: '100%', minHeight: 44, borderRadius: 10, border: 'none',
            background: busy ? '#c8d2dc' : TEAL, color: 'white',
            fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer'
          }}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    </div>
  )
}
