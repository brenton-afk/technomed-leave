import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { useLiveRefresh } from '../../liveRefresh.js'
import { useIsDesktop } from '../../design/viewport.js'
import { STAFF } from '../../staffConfig.js'
import { orderedItems } from '../../projects/agendaOrder.js'

// ─── The next meeting's agenda (Brent, 11 and 12 Nov 2026) ───────────────────
// "The agendas [should] be written based off the projects completed report …
// a section for the items that are not completed, so we don't waste time
// asking staff to tell us about the things we thought weren't done. Ideally,
// Erin would tell the portal the date and time of the meeting and the agenda
// would build as an exportable and printable file and Erin could add items …
// a Claude chat … to build the agenda from scratch using the data in the
// projects report."
//
// So: Erin sets the date and time (Set up the next meeting); the agenda is the
// document as it will print — header, then the actions since the last
// meeting (Completed / Not completed, worked out from the projects every time,
// never typed), then her numbered items. She adds, edits and orders items by
// hand, or asks Claude in the chat beside it. Everyone reads it live; only
// Erin (AGENDA_EDITORS) changes it. Word and Print for everyone.

const dmy = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Hobart' }) : '')
const short = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Hobart' }) : '')
const first = name => String(name || '').split(' ')[0]

/**
 * The agenda in its printed order (Brent, 12 Nov 2026): Welcome and apologies,
 * General business, the actions not yet completed (from the projects page),
 * Erin's other items, Next meeting last. The server keeps the three standing
 * items in place (orderedItems in api/_agenda.js); this slots the actions in
 * after General business. Completed work is never on it. Pure.
 */
export function agendaSections(a, actions) {
  const items = orderedItems(a?.items || [])
  const at = items.findIndex(i => /general\s+business/i.test(i.title))
  const cut = at >= 0 ? at + 1 : Math.min(items.length, 1)
  const outstanding = { kind: 'actions', title: 'Actions not yet completed', rows: actions?.notDone || [], since: actions?.since || null }
  return [...items.slice(0, cut).map(i => ({ kind: 'item', ...i })), outstanding, ...items.slice(cut).map(i => ({ kind: 'item', ...i }))]
}

const actionLine = t => `${t.task} — ${first(t.assignee)}${t.due_date ? `, due ${short(t.due_date)}${t.overdue ? ' (overdue)' : ''}` : ''}`

/** The agenda as plain text, numbered as Erin numbers it. Pure. */
export function agendaText(a, actions = null) {
  if (!a) return ''
  const head = [a.title, a.date && `Date: ${dmy(a.date)}`, a.time && `Time: ${a.time}`, a.location && `Location: ${a.location}`,
    a.attendees && `Attendees: ${a.attendees}`, a.apologies && `Apologies: ${a.apologies}`, a.chair && `Chair: ${a.chair}`].filter(Boolean)
  const body = agendaSections(a, actions).map((sec, i) => (sec.kind === 'actions'
    ? [`${i + 1}. ${sec.title}${sec.since?.date ? ` (since ${short(sec.since.date)})` : ''}`, ...(sec.rows.length ? sec.rows.map(t => `   ○ ${actionLine(t)}`) : ['   None outstanding'])].join('\n')
    : [`${i + 1}. ${sec.title}${sec.lead ? ` — ${sec.lead}` : ''}`, ...(sec.points || []).map(p => `   • ${p}`)].join('\n')))
  return [...head, '', ...body].join('\n')
}

async function agendaWord(a, actions) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = await import('docx')
  const run = (t, o = {}) => new TextRun({ text: t, font: 'Arial', ...o })
  const p = (t, o = {}, r = {}) => new Paragraph({ children: [run(t, r)], ...o })
  const cell = (children, w) => new TableCell({ children, width: { size: w, type: WidthType.PERCENTAGE } })
  const head = [['Date', dmy(a.date)], ['Time', a.time], ['Location', a.location], ['Attendees', a.attendees], ['Apologies', a.apologies], ['Chair', a.chair]]
    .filter(([, v]) => v).map(([k, v]) => new Paragraph({ children: [run(`${k}: `, { bold: true }), run(v)] }))
  const rows = [
    new TableRow({ children: [cell([p('#', {}, { bold: true })], 6), cell([p('Item', {}, { bold: true })], 34), cell([p('Discussion points', {}, { bold: true })], 45), cell([p('Lead', {}, { bold: true })], 15)] }),
    ...agendaSections(a, actions).map((sec, i) => new TableRow({ children: [
      cell([p(String(i + 1))], 6),
      cell([p(sec.title, {}, sec.kind === 'actions' ? { bold: true } : {})], 34),
      cell(sec.kind === 'actions'
        ? (sec.rows.length ? sec.rows.map(t => p(actionLine(t), { bullet: { level: 0 } })) : [p('None outstanding')])
        : (sec.points?.length ? sec.points : ['']).map(pt => p(pt, pt ? { bullet: { level: 0 } } : {})), 45),
      cell([p(sec.kind === 'actions' ? 'Owners' : (sec.lead || ''))], 15)
    ] }))
  ]
  return Packer.toBlob(new Document({ sections: [{ children: [
    p('Agenda', {}, { bold: true, size: 36 }), p(a.title, {}, { bold: true, size: 28 }), ...head, p(''),
    new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
  ] }] }))
}

// ─── Who is coming (Brent, 12 Nov 2026: "Attendees need to be buttons") ─────
// One button per member of staff: a tap marks them attending, a second an
// apology, a third clears them. Anyone else (a rep from a supplier) is typed.
// Stored as the same comma-separated lines the agenda already prints.

export const splitNames = v => String(v || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase()

/** Moves a name on: not marked → attending → apology → not marked. Pure. */
export function cycleAttendance(name, { attendees = '', apologies = '' } = {}) {
  const going = splitNames(attendees)
  const away = splitNames(apologies)
  const without = list => list.filter(n => !sameName(n, name))
  if (going.some(n => sameName(n, name))) return { attendees: without(going).join(', '), apologies: [...away, name].join(', ') }
  if (away.some(n => sameName(n, name))) return { attendees: going.join(', '), apologies: without(away).join(', ') }
  return { attendees: [...going, name].join(', '), apologies: away.join(', ') }
}

function WhoIsComing({ value, onChange, chip, field }) {
  const [guest, setGuest] = useState('')
  const going = splitNames(value.attendees)
  const away = splitNames(value.apologies)
  const staffNames = STAFF.map(s => s.name)
  const guests = [...going, ...away].filter(n => !staffNames.some(s => sameName(s, n)))
  const state = n => (going.some(x => sameName(x, n)) ? 'going' : away.some(x => sameName(x, n)) ? 'away' : '')
  const addGuest = () => { const n = guest.trim(); if (!n) return; onChange({ ...value, attendees: [...going, n].join(', ') }); setGuest('') }
  return (
    <div data-who-coming>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {[...staffNames, ...guests].map(n => {
          const s = state(n)
          return (
            <button key={n} type="button" aria-pressed={Boolean(s)} data-attendee={s || 'none'}
              onClick={() => onChange({ ...value, ...cycleAttendance(n, value) })}
              style={chip(s)}>
              {s === 'going' ? '✓ ' : s === 'away' ? '✕ ' : ''}{n}
            </button>
          )
        })}
        <button type="button" onClick={() => onChange({ ...value, attendees: [...new Set([...going, ...staffNames.filter(n => !away.some(x => sameName(x, n)))])].join(', ') })}
          style={chip('all')}>Everyone</button>
      </div>
      <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 4 }}>Tap once: attending · twice: apology · three times: clear</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input value={guest} onChange={e => setGuest(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addGuest() }}
          placeholder="Someone else attending (e.g. a supplier rep)" aria-label="Add a guest" style={{ ...field, flex: 1 }} />
        <button type="button" onClick={addGuest} disabled={!guest.trim()} style={chip('')}>Add</button>
      </div>
    </div>
  )
}

const STARTERS = [
  'The next meeting is Wednesday 25 November at 9am',
  'Build the agenda from the report',
  'Add an item about the Christmas roster, led by Erin',
  'Everyone is coming except Toni'
]

export default function Agenda({ user, onClose, today }) {
  const auth = { Authorization: `Bearer ${user?.token || ''}` }
  const wide = useIsDesktop()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [said, setSaid] = useState('')
  const [undo, setUndo] = useState(null)
  const [pane, setPane] = useState('chat') // a phone shows one at a time
  const chatEnd = useRef(null)

  const call = async (action, method, body) => {
    const res = await fetch(`/api/meetings/agent?action=${action}`, {
      method, headers: { ...auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(out.error || 'That did not work'), { out, status: res.status })
    return out
  }

  const load = useCallback(async () => {
    try { setData(await call('agenda', 'GET')); setError('') } catch (err) { setError(err.message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])
  useEffect(() => { load() }, [load])
  useLiveRefresh(useCallback(() => { if (!busy) load() }, [busy, load]), [busy, load])

  const agenda = data?.agenda
  const actions = data?.actions
  const chat = data?.chat || []
  const canEdit = Boolean(data?.canEdit)
  useEffect(() => { chatEnd.current?.scrollIntoView?.({ block: 'end' }) }, [chat.length, busy])

  async function save(next, message = 'Saved.') {
    setBusy('save'); setNote('')
    try {
      const { agenda: saved } = await call('agenda', 'PUT', { agenda: next, version: agenda?.version || 0 })
      setUndo(agenda); setData(d => ({ ...d, agenda: saved })); setNote(message)
    } catch (err) {
      if (err.status === 409 && err.out?.agenda) setData(d => ({ ...d, agenda: err.out.agenda }))
      setNote(err.message)
    }
    setBusy('')
  }
  async function ask(words) {
    const message = String(words ?? said).trim()
    if (!message || busy === 'chat') return
    setSaid(''); setBusy('chat'); setNote('')
    setData(d => ({ ...d, chat: [...(d?.chat || []), { role: 'user', text: message }] }))
    try {
      const out = await call('agenda-chat', 'POST', { text: message })
      if (out.changed) setUndo(out.previous || agenda)
      setData(d => ({ ...d, chat: out.chat, agenda: out.agenda ?? d.agenda, actions: out.actions ?? d.actions }))
    } catch (err) {
      setData(d => ({ ...d, chat: [...(d?.chat || []), { role: 'assistant', text: err.message, failed: true }] }))
    }
    setBusy('')
  }
  async function freshChat() {
    try { const out = await call('agenda-chat', 'DELETE'); setData(d => ({ ...d, chat: out.chat })) } catch (err) { setNote(err.message) }
  }
  async function importPast() {
    setBusy('import'); setNote('')
    try {
      const out = await call('agenda-import', 'POST', {})
      setNote(`Read ${out.read} agenda${out.read === 1 ? '' : 's'} from email — ${out.added} new.`)
      await load()
    } catch (err) { setNote(err.message) }
    setBusy('')
  }
  async function download() {
    try {
      const blob = await agendaWord(agenda, actions)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `TechnoMed Staff Meeting Agenda ${agenda.date || today}.docx`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch (err) { setNote(err.message) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(agendaText(agenda, actions)); setNote('Copied.') } catch { setNote('Could not copy on this device.') }
  }

  const btn = on => ({ ...text('caption'), fontWeight: 700, minHeight: 38, padding: `0 ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
    border: on ? 'none' : border.hairline, background: on ? colour.navy : colour.surface, color: on ? colour.surface : colour.ink })
  const field = { ...text('body'), fontSize: 16, width: '100%', boxSizing: 'border-box', padding: `${space.xs}px ${space.sm}px`, border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink }
  const chip = state => ({
    ...text('caption'), fontWeight: 600, minHeight: 36, padding: `0 ${space.sm}px`, borderRadius: radius.pill, cursor: 'pointer',
    border: state === 'going' ? `1px solid ${colour.accent}` : state === 'away' ? `1px solid ${colour.dangerLine}` : border.hairline,
    background: state === 'going' ? colour.accentSoft : state === 'away' ? colour.dangerSoft : state === 'all' ? colour.canvas : colour.surface,
    color: state === 'going' ? colour.accentDeep : state === 'away' ? colour.danger : colour.ink
  })
  const card = { background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md }

  // ── The agenda, as it prints ──
  const doc = agenda ? (
    <div data-agenda-view>
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
        {agenda.date && agenda.date < today && <div data-no-print style={{ ...text('caption'), color: colour.warning, marginTop: space.xs }}>This was for a meeting that has passed — tell Claude when the next one is.</div>}
      </div>

      {canEdit && (
        <details data-no-print style={{ ...card, padding: `${space.sm}px ${space.md}px`, marginTop: space.sm }}>
          <summary style={{ ...text('bodyStrong'), color: colour.ink, cursor: 'pointer' }}>
            Who is coming · {splitNames(agenda.attendees).length} attending{splitNames(agenda.apologies).length ? `, ${splitNames(agenda.apologies).length} apolog${splitNames(agenda.apologies).length === 1 ? 'y' : 'ies'}` : ''}
          </summary>
          <div style={{ marginTop: space.sm }}>
            <WhoIsComing value={{ attendees: agenda.attendees, apologies: agenda.apologies }}
              onChange={v => save({ ...agenda, ...v })} chip={chip} field={field} />
          </div>
        </details>
      )}

      <div style={{ ...text('heading'), color: colour.ink, margin: `${space.md}px 0 ${space.xs}px` }}>Agenda</div>
      {agendaSections(agenda, actions).map((sec, i) => (sec.kind === 'actions' ? (
        <div key="actions" data-agenda-actions style={{ display: 'flex', gap: space.sm, background: colour.surface, border: `1px solid ${colour.dangerLine}`, borderRadius: radius.control, padding: space.sm, marginTop: space.xs }}>
          <span style={{ ...text('heading'), color: colour.accentDeep, minWidth: 22 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...text('bodyStrong'), color: colour.ink }}>{sec.title}{sec.since?.date ? <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}> · since {short(sec.since.date)}</span> : null}</div>
            <div data-no-print style={{ ...text('caption'), color: colour.inkFaint }}>From the projects page — tick a task there and it comes off.</div>
            {sec.rows.length === 0 && <div style={{ ...text('body'), color: colour.inkMuted }}>None outstanding.</div>}
            {sec.rows.map((t, j) => (
              <div key={j} data-agenda-notdone style={{ ...text('body'), color: colour.ink, display: 'flex', gap: space.xs, padding: '3px 0', borderBottom: border.hairlineSoft }}>
                <span style={{ color: t.overdue ? colour.danger : colour.inkFainter }}>○</span><span style={{ flex: 1, minWidth: 0 }}>{t.task}</span>
                <span style={{ ...text('caption'), color: t.overdue ? colour.danger : colour.inkFaint, whiteSpace: 'nowrap' }}>{first(t.assignee)}{t.due_date ? ` · ${t.overdue ? 'overdue ' : 'due '}${short(t.due_date)}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div key={sec.id || i} data-agenda-item style={{ display: 'flex', gap: space.sm, background: colour.surface, border: border.hairline, borderRadius: radius.control, padding: space.sm, marginTop: space.xs }}>
          <span style={{ ...text('heading'), color: colour.accentDeep, minWidth: 22 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...text('bodyStrong'), color: colour.ink }}>{sec.title}{sec.lead ? <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}> · {sec.lead}</span> : null}</div>
            {(sec.points || []).map((p, j) => <div key={j} style={{ ...text('body'), color: colour.inkMuted }}>• {p}</div>)}
          </div>
        </div>
      )))}
      {agenda.updatedAt && (
        <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: space.sm }}>
          Updated {new Date(agenda.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{agenda.updatedBy ? ` by ${agenda.updatedBy}` : ''}
        </div>
      )}
    </div>
  ) : data && (
    <div style={{ ...text('body'), color: colour.inkFaint }}>{canEdit ? 'No agenda yet — tell Claude when the next meeting is.' : 'Erin has not put the next agenda up yet.'}</div>
  )

  // ── The conversation ──
  const chatPanel = canEdit && (
    <div data-agenda-chat data-no-print style={{ ...card, display: 'flex', flexDirection: 'column', gap: space.sm, minHeight: wide ? 'calc(100vh - 140px)' : 'calc(100dvh - 190px)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm }}>
        <div style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Build the agenda with Claude</div>
        {chat.length > 0 && <button type="button" onClick={freshChat} style={{ ...text('caption'), border: 'none', background: 'none', color: colour.inkFaint, cursor: 'pointer' }}>New conversation</button>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: space.xs }}>
        {chat.length === 0 && (
          <div style={{ ...text('body'), color: colour.inkMuted }}>
            Tell me when the next meeting is and who is coming, and I will build it from the projects report, with everything not yet done.  Then just say what to add or change.
          </div>
        )}
        {chat.length === 0 && STARTERS.map(st => (
          <button key={st} type="button" onClick={() => ask(st)}
            style={{ ...text('body'), textAlign: 'left', padding: `${space.xs}px ${space.sm}px`, borderRadius: radius.control, border: border.hairline, background: colour.canvas, color: colour.ink, cursor: 'pointer' }}>{st}</button>
        ))}
        {chat.map((m, i) => (
          <div key={i} data-chat-role={m.role} style={{ ...text('body'), alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%',
            background: m.role === 'user' ? colour.accentSoft : m.failed ? colour.dangerSoft : colour.canvas, color: colour.ink,
            borderRadius: radius.card, padding: `${space.xs}px ${space.sm}px`, whiteSpace: 'pre-wrap' }}>
            {m.text}
            {m.changed && (m.changes?.length
              ? <ul data-chat-changes style={{ ...text('caption'), color: colour.accentDeep, margin: '4px 0 0', paddingLeft: 0, listStyle: 'none' }}>
                  {m.changes.map((c, j) => <li key={j}>✓ {c}</li>)}
                </ul>
              : <div style={{ ...text('caption'), color: colour.accentDeep, marginTop: 2 }}>✓ Agenda updated</div>)}
            {m.role === 'assistant' && !m.changed && !m.failed && <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>No change made</div>}
          </div>
        ))}
        {busy === 'chat' && <div style={{ ...text('caption'), color: colour.inkFaint }}>Claude is working on it…</div>}
        <div ref={chatEnd} />
      </div>
      <div style={{ display: 'flex', gap: space.xs }}>
        <input value={said} onChange={e => setSaid(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask() }}
          placeholder="Message Claude about the agenda…" aria-label="Message Claude" style={{ ...field, flex: 1 }} />
        <button type="button" onClick={() => ask()} disabled={busy === 'chat' || !said.trim()} style={btn(true)}>Send</button>
      </div>
      <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap' }}>
        {undo && <button type="button" onClick={() => { const back = undo; setUndo(null); save(back, 'Last change undone.') }} style={btn(false)}>Undo last change</button>}
        <button type="button" onClick={importPast} disabled={Boolean(busy)} style={{ ...text('caption'), border: 'none', background: 'none', color: colour.inkFaint, cursor: 'pointer' }}>
          {busy === 'import' ? 'Reading your email…' : `Import past agendas from email${data?.past?.length ? ` (${data.past.length} in)` : ''}`}
        </button>
      </div>
    </div>
  )

  return (
    <Overlay>
      <div role="dialog" aria-label="Meeting agenda" data-meeting-report style={{
        position: 'fixed', inset: 0, zIndex: 3500, background: colour.canvas, overflowY: 'auto', overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}>
        <div style={{ maxWidth: wide && canEdit ? 1240 : 760, margin: '0 auto', padding: space.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
            <div style={{ ...text('title'), color: colour.ink, flex: 1 }}>Next meeting agenda</div>
            <button type="button" onClick={onClose} aria-label="Close" style={btn(false)}>✕</button>
          </div>
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger }}>{error}</div>}
          {!data && !error && <div style={{ ...text('body'), color: colour.inkFaint }}>Loading…</div>}
          {note && <div role="status" style={{ ...text('caption'), color: colour.accentDeep, marginBottom: space.sm }}>{note}</div>}

          {data && (canEdit && wide ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: space.md, alignItems: 'start' }}>
              {chatPanel}<div>{doc}</div>
            </div>
          ) : canEdit ? (
            <>
              <div data-no-print role="tablist" style={{ display: 'flex', borderBottom: border.hairline, marginBottom: space.sm }}>
                {[['chat', 'Chat'], ['agenda', 'Agenda']].map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={pane === k} onClick={() => setPane(k)}
                    style={{ ...text('bodyStrong'), flex: 1, minHeight: 44, border: 'none', background: 'none', cursor: 'pointer',
                      color: pane === k ? colour.ink : colour.inkFaint, borderBottom: pane === k ? `3px solid ${colour.accent}` : '3px solid transparent' }}>{l}</button>
                ))}
              </div>
              {pane === 'chat' ? chatPanel : doc}
            </>
          ) : doc)}
        </div>
      </div>
    </Overlay>
  )
}
