import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { useLiveRefresh } from '../../liveRefresh.js'
import { CONFIRM_ANSWERS } from '../../clinicalPlan/inSituSummary.js'

// ─── What is in situ, on the week (Brent, 17 Nov 2026) ───────────────────────
// "It just places an In situ? marking on the booking. That's not helpful." The
// day's red flag for a case now carries the answer — one sentence from the
// earlier usages (api/_inSitu.js) — and the rep confirms it: same patient /
// not this patient, or, when nothing was found, that they have checked. The
// card's tag says where that stands. Answers come for the week in one call and
// refresh with the week.

const Ctx = createContext({ answers: {}, confirm: () => {}, busy: '' })

/** The in-situ flags' cases, from the plan on screen. */
function inSituCases(plan) {
  return (plan?.days || []).flatMap(d => (d.flags || []).map(f => f.inSituCase).filter(Boolean))
}

export function InSituProvider({ plan, token, children }) {
  const [answers, setAnswers] = useState({})
  const [busy, setBusy] = useState('')
  const cases = useMemo(() => inSituCases(plan), [plan])
  const wanted = cases.map(c => `${c.id}|${c.patient}|${c.date}`).join(',')
  const headers = useMemo(() => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }), [token])

  const load = useCallback(async () => {
    if (!cases.length) return
    try {
      const res = await fetch('/api/calendar/today?action=insitu', { method: 'POST', headers, body: JSON.stringify({ cases }) })
      const data = await res.json().catch(() => ({}))
      if (data.answers) setAnswers(a => ({ ...a, ...data.answers }))
      // Some still being looked up: ask again shortly rather than in a minute.
      if (Object.values(data.answers || {}).some(x => x.status === 'pending')) setTimeout(load, 4000)
    } catch { /* the flag's own words stand */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, headers])

  useEffect(() => { load() }, [load])
  useLiveRefresh(load, [load])

  const confirm = useCallback(async (c, answer) => {
    setBusy(c.id)
    try {
      const res = await fetch('/api/calendar/today?action=insitu-confirm', { method: 'POST', headers, body: JSON.stringify({ case: c, answer }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) setAnswers(a => ({ ...a, [c.id]: { ...(a[c.id] || {}), confirmed: data.confirmed || null } }))
    } finally {
      setBusy('')
    }
  }, [headers])

  return <Ctx.Provider value={{ answers, confirm, busy }}>{children}</Ctx.Provider>
}

export const useInSitu = () => useContext(Ctx)

/** The short tag on a case card. */
export function inSituTag(answer) {
  if (!answer || answer.status === 'pending' || answer.status === 'error') return 'In situ?'
  const ok = answer.confirmed?.answer
  if (ok === 'same' || ok === 'none-confirmed') return 'In situ ✓'
  if (ok === 'not-this-patient') return 'In situ: not found'
  if (answer.status === 'found') return 'In situ: confirm'
  return 'No usage found'
}

const pill = on => ({
  ...text('caption'), fontWeight: 700, padding: '4px 10px', borderRadius: radius.pill, cursor: 'pointer',
  border: `1px solid ${on ? colour.accent : colour.line}`, background: on ? colour.accent : colour.surface,
  color: on ? 'white' : colour.ink
})

/** The day's in-situ flag: the answer, and the rep's confirmation. */
export function InSituFlag({ flag, compact = false }) {
  const { answers, confirm, busy } = useInSitu()
  const c = flag.inSituCase
  const a = answers[c.id]
  const done = a?.confirmed
  const found = a?.status === 'found'
  const settled = done && (done.answer === 'same' || done.answer === 'none-confirmed')
  const tone = settled
    ? { color: colour.accentDeep, background: colour.accentSoft, border: colour.accent }
    : { color: colour.danger, background: colour.dangerSoft, border: colour.dangerLine }
  const options = found ? ['same', 'not-this-patient'] : ['none-confirmed']
  return (
    <div data-day-flag="inSitu" data-in-situ-flag={c.id} style={{
      ...text(compact ? 'micro' : 'body'), textTransform: 'none', lineHeight: 1.4,
      color: tone.color, background: tone.background, border: `1px solid ${tone.border}`,
      borderRadius: radius.control, padding: compact ? '5px 7px' : `${space.sm}px ${space.md}px`,
      marginBottom: compact ? 4 : space.xs
    }}>
      <div style={{ fontWeight: 700 }}>In situ — {c.who} ({c.inSitu})</div>
      <div data-in-situ-answer style={{ color: colour.ink, marginTop: 2 }}>
        {a?.sentence || 'Looking for earlier usages…'}
      </div>
      {done && (
        <div style={{ ...text('caption'), marginTop: 4, color: tone.color }}>
          {CONFIRM_ANSWERS[done.answer]} by {done.by}
          {' '}<button type="button" onClick={() => confirm(c, 'clear')} disabled={busy === c.id}
            style={{ background: 'none', border: 'none', padding: 0, color: colour.inkMuted, textDecoration: 'underline', cursor: 'pointer', ...text('caption') }}>Undo</button>
        </div>
      )}
      {!done && a && a.status !== 'pending' && a.status !== 'error' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {options.map(opt => (
            <button key={opt} type="button" data-in-situ-confirm={opt} disabled={busy === c.id}
              onClick={() => confirm(c, opt)} style={pill(opt !== 'not-this-patient')}>
              {opt === 'same' ? 'Same patient' : opt === 'not-this-patient' ? 'Not this patient' : "I've checked"}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
