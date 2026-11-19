import React, { useEffect, useState } from 'react'
import { useBackLayer } from '../../backButton.js'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import { agendaSections, agendaText, agendaWord } from './Agenda.jsx'

// ─── Saved agendas (Brent, 19 Nov 2026) ──────────────────────────────────────
// "They stay in the meetings tab as saved agendas from meetings." Every agenda
// Erin saved, newest first, each opened as it read when saved — with Word,
// Print and Copy. Read-only, for everyone signed in (api/_agenda.js).

const dmy = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Hobart' }) : '')
const short = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Hobart' }) : '')
const first = name => String(name || '').split(' ')[0]

function SavedOne({ agenda, onNote }) {
  const btn = on => ({ ...text('caption'), fontWeight: 700, minHeight: 38, padding: `0 ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer', ...(on ? face.navy : face.secondary) })
  const card = { background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md }
  async function download() {
    try {
      const blob = await agendaWord(agenda, agenda.actions)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `TechnoMed Staff Meeting Agenda ${agenda.date || agenda.savedAt?.slice(0, 10) || ''}.docx`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch (err) { onNote(err.message) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(agendaText(agenda, agenda.actions)); onNote('Copied.') } catch { onNote('Could not copy on this device.') }
  }
  return (
    <div data-saved-agenda-view>
      <div data-no-print style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginBottom: space.sm }}>
        <button type="button" onClick={download} style={btn(true)}>Download Word</button>
        <button type="button" onClick={() => window.print()} style={btn(false)}>Print</button>
        <button type="button" onClick={copy} style={btn(false)}>Copy</button>
      </div>
      <div style={card}>
        <div style={{ ...text('title'), color: colour.ink }}>{agenda.title}</div>
        {[['Date', dmy(agenda.date)], ['Time', agenda.time], ['Location', agenda.location], ['Chair', agenda.chair], ['Attendees', agenda.attendees], ['Apologies', agenda.apologies]]
          .filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ ...text('body'), color: colour.inkMuted, marginTop: 2 }}><b style={{ color: colour.ink }}>{k}:</b> {v}</div>
          ))}
      </div>
      {agendaSections(agenda, agenda.actions).map((sec, i) => (
        <div key={sec.id || `s${i}`} style={{ display: 'flex', gap: space.sm, background: colour.surface, border: border.hairline, borderRadius: radius.control, padding: space.sm, marginTop: space.xs }}>
          <span style={{ ...text('heading'), color: colour.accentDeep, minWidth: 22 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...text('bodyStrong'), color: colour.ink }}>{sec.title}{sec.lead ? <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}> · {sec.lead}</span> : null}</div>
            {sec.kind === 'actions'
              ? (sec.rows.length ? sec.rows.map((t, j) => (
                <div key={j} style={{ ...text('body'), color: colour.ink }}>○ {t.task} <span style={{ ...text('caption'), color: t.overdue ? colour.danger : colour.inkFaint }}>— {first(t.assignee)}{t.due_date ? `, ${t.overdue ? 'overdue' : 'due'} ${short(t.due_date)}` : ''}</span></div>
              )) : <div style={{ ...text('body'), color: colour.inkMuted }}>None outstanding.</div>)
              : (sec.points || []).map((p, j) => <div key={j} style={{ ...text('body'), color: colour.inkMuted }}>• {p}</div>)}
          </div>
        </div>
      ))}
      <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: space.sm }}>
        Saved {agenda.savedAt ? new Date(agenda.savedAt).toLocaleString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}{agenda.savedBy ? ` by ${agenda.savedBy}` : ''}
      </div>
    </div>
  )
}

export default function SavedAgendas({ user, onClose }) {
  useBackLayer(true, () => onClose?.())
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  useBackLayer(Boolean(open), () => setOpen(null))
  const headers = { Authorization: `Bearer ${user?.token || ''}` }

  const get = async q => {
    const res = await fetch(`/api/meetings/agent?action=agendas${q}`, { headers })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error || 'Could not read the saved agendas')
    return out
  }
  useEffect(() => {
    get('').then(d => setList(d.agendas || [])).catch(err => setError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])
  async function openOne(id) {
    setError(''); setNote('')
    try { setOpen((await get(`&id=${encodeURIComponent(id)}`)).agenda) } catch (err) { setError(err.message) }
  }

  const btn = { ...text('caption'), fontWeight: 700, minHeight: 38, padding: `0 ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer', ...face.secondary }
  return (
    <Overlay>
      <div role="dialog" aria-label="Saved agendas" data-meeting-report style={{
        position: 'fixed', inset: 0, zIndex: 3500, background: colour.canvas, overflowY: 'auto', overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: space.md }}>
          <div data-no-print style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
            {open && <button type="button" onClick={() => setOpen(null)} aria-label="Back to saved agendas" style={btn}>‹</button>}
            <div style={{ ...text('title'), color: colour.ink, flex: 1 }}>{open ? (short(open.date) || 'Saved agenda') : 'Saved agendas'}</div>
            <button type="button" onClick={onClose} aria-label="Close" style={btn}>✕</button>
          </div>
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger }}>{error}</div>}
          {note && <div role="status" style={{ ...text('caption'), color: colour.accentDeep, marginBottom: space.sm }}>{note}</div>}
          {open ? <SavedOne agenda={open} onNote={setNote} /> : (
            <>
              {!list && !error && <div style={{ ...text('body'), color: colour.inkFaint }}>Loading…</div>}
              {list && list.length === 0 && <div style={{ ...text('body'), color: colour.inkFaint }}>No agendas saved yet. Erin saves one from the agenda with Save agenda.</div>}
              {list && list.length > 0 && (
                <div style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, overflow: 'hidden' }}>
                  {list.map((a, i) => (
                    <button key={a.id} type="button" data-saved-agenda={a.id} onClick={() => openOne(a.id)} style={{
                      width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: space.sm, cursor: 'pointer',
                      background: 'transparent', border: 'none', borderTop: i ? `1px solid ${colour.lineSoft}` : 'none',
                      padding: `${space.sm}px ${space.md}px`, minHeight: 56, color: colour.ink
                    }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ ...text('bodyStrong'), display: 'block' }}>{a.date ? dmy(a.date) : 'No date set'}</span>
                        <span style={{ ...text('caption'), color: colour.inkFaint }}>{[a.title, a.time, `${a.items} items`, a.savedBy && `saved by ${a.savedBy}`].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span aria-hidden="true" style={{ color: colour.inkFaint }}>›</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Overlay>
  )
}
