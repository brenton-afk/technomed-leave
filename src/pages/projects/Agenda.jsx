import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { useLiveRefresh } from '../../liveRefresh.js'
import { useIsDesktop } from '../../design/viewport.js'

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

/** The agenda as plain text, numbered as Erin numbers it. Pure. */
export function agendaText(a, actions = null) {
  if (!a) return ''
  const head = [a.title, a.date && `Date: ${dmy(a.date)}`, a.time && `Time: ${a.time}`, a.location && `Location: ${a.location}`,
    a.attendees && `Attendees: ${a.attendees}`, a.apologies && `Apologies: ${a.apologies}`, a.chair && `Chair: ${a.chair}`].filter(Boolean)
  const acts = actions ? [
    '', `Actions since ${actions.since?.title || 'the last meeting'}${actions.since?.date ? ` (${short(actions.since.date)})` : ''}`,
    `Completed (${actions.done.length})`, ...actions.done.map(t => `   ✓ ${t.task} — ${first(t.assignee)}${t.doneOn ? `, ${short(t.doneOn)}` : ''}`),
    `Not completed (${actions.notDone.length})`, ...actions.notDone.map(t => `   ○ ${t.task} — ${first(t.assignee)}${t.due_date ? `, due ${short(t.due_date)}${t.overdue ? ' (overdue)' : ''}` : ''}`)
  ] : []
  const items = (a.items || []).map((it, i) => [`${i + 1}. ${it.title}${it.lead ? ` — ${it.lead}` : ''}`, ...(it.points || []).map(p => `   • ${p}`)].join('\n'))
  return [...head, ...acts, '', ...items].join('\n')
}

async function agendaWord(a, actions) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = await import('docx')
  const run = (t, o = {}) => new TextRun({ text: t, font: 'Arial', ...o })
  const p = (t, o = {}, r = {}) => new Paragraph({ children: [run(t, r)], ...o })
  const cell = (children, w) => new TableCell({ children, width: { size: w, type: WidthType.PERCENTAGE } })
  const head = [['Date', dmy(a.date)], ['Time', a.time], ['Location', a.location], ['Attendees', a.attendees], ['Apologies', a.apologies], ['Chair', a.chair]]
    .filter(([, v]) => v).map(([k, v]) => new Paragraph({ children: [run(`${k}: `, { bold: true }), run(v)] }))
  const table = (cols, rows) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: cols.map(([h, w]) => cell([p(h, {}, { bold: true })], w)) }),
      ...rows.map(r => new TableRow({ children: r.map((v, i) => cell([p(String(v || ''))], cols[i][1])) }))]
  })
  const acts = actions ? [
    p(''), p(`Actions since ${actions.since?.title || 'the last meeting'}${actions.since?.date ? ` (${short(actions.since.date)})` : ''}`, {}, { bold: true, size: 26 }),
    p(`Completed (${actions.done.length})`, {}, { bold: true }),
    ...(actions.done.length ? [table([['Action', 60], ['Who', 20], ['Done', 20]], actions.done.map(t => [t.task, first(t.assignee), short(t.doneOn)]))] : [p('None')]),
    p(''), p(`Not completed (${actions.notDone.length})`, {}, { bold: true }),
    ...(actions.notDone.length ? [table([['Action', 60], ['Who', 20], ['Due', 20]], actions.notDone.map(t => [t.task, first(t.assignee), t.due_date ? `${short(t.due_date)}${t.overdue ? ' — overdue' : ''}` : '']))] : [p('None')])
  ] : []
  const rows = [
    new TableRow({ children: [cell([p('#', {}, { bold: true })], 6), cell([p('Item', {}, { bold: true })], 34), cell([p('Discussion points', {}, { bold: true })], 45), cell([p('Lead', {}, { bold: true })], 15)] }),
    ...(a.items || []).map((it, i) => new TableRow({ children: [
      cell([p(String(i + 1))], 6), cell([p(it.title)], 34),
      cell((it.points?.length ? it.points : ['']).map(pt => p(pt, pt ? { bullet: { level: 0 } } : {})), 45), cell([p(it.lead || '')], 15)
    ] }))
  ]
  return Packer.toBlob(new Document({ sections: [{ children: [
    p('Agenda', {}, { bold: true, size: 36 }), p(a.title, {}, { bold: true, size: 28 }), ...head, ...acts, p(''),
    p('Items for discussion', {}, { bold: true, size: 26 }),
    new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
  ] }] }))
}

const STARTERS = [
  'Build the agenda from the report',
  'Turn the not-completed items into discussion points by person',
  'Add an item: '
]

export default function Agenda({ user, onClose, today }) {
  const auth = { Authorization: `Bearer ${user?.token || ''}` }
  const wide = useIsDesktop()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [setup, setSetup] = useState(null)        // { date, time, location } while setting up
  const [editItem, setEditItem] = useState(null)  // { index, title, points, lead }
  const [newItem, setNewItem] = useState('')
  const [chat, setChat] = useState([])
  const [said, setSaid] = useState('')
  const [undo, setUndo] = useState(null)
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
  useLiveRefresh(useCallback(() => { if (!editItem && !setup && !busy) load() }, [editItem, setup, busy, load]), [editItem, setup, busy, load])
  useEffect(() => { chatEnd.current?.scrollIntoView?.({ block: 'end' }) }, [chat])

  const agenda = data?.agenda
  const actions = data?.actions
  const canEdit = Boolean(data?.canEdit)
  const due = !agenda?.date || agenda.date < today

  async function save(next, message = 'Saved — everyone sees this now.') {
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
  async function startMeeting() {
    setBusy('setup'); setNote('')
    try {
      const out = await call('agenda-setup', 'POST', setup)
      setUndo(agenda); setData(d => ({ ...d, agenda: out.agenda, actions: out.actions })); setSetup(null)
      setNote('Agenda started — the actions since the last meeting are filled in. Add items, or ask Claude.')
    } catch (err) { setNote(err.message) }
    setBusy('')
  }
  async function ask(words) {
    const message = String(words || said).trim()
    if (!message) return
    const next = [...chat, { role: 'user', text: message }]
    setChat(next); setSaid(''); setBusy('chat')
    try {
      const out = await call('agenda-chat', 'POST', { messages: next })
      setChat(c => [...c, { role: 'assistant', text: out.reply || 'Done.' }])
      if (out.changed) { setUndo(out.previous || agenda); setData(d => ({ ...d, agenda: out.agenda, actions: out.actions ?? d.actions })) }
    } catch (err) {
      setChat(c => [...c, { role: 'assistant', text: err.message, failed: true }])
    }
    setBusy('')
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

  const items = agenda?.items || []
  const withItems = next => save({ ...agenda, items: next })
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= items.length) return; const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; withItems(next) }

  const btn = on => ({ ...text('caption'), fontWeight: 700, minHeight: 38, padding: `0 ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
    border: on ? 'none' : border.hairline, background: on ? colour.navy : colour.surface, color: on ? colour.surface : colour.ink })
  const small = { ...text('caption'), minHeight: 32, minWidth: 32, borderRadius: radius.control, border: border.hairline, background: colour.surface, color: colour.inkMuted, cursor: 'pointer' }
  const field = { ...text('body'), fontSize: 16, width: '100%', boxSizing: 'border-box', padding: `${space.xs}px ${space.sm}px`, border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink }
  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, display: 'block', marginBottom: 2 }
  const sectionHead = { ...text('heading'), color: colour.ink, margin: `${space.md}px 0 ${space.xs}px` }

  const setupCard = (
    <div data-agenda-setup style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md, marginBottom: space.md }}>
      <div style={{ ...text('heading'), color: colour.ink }}>Set up the next meeting</div>
      <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
        The agenda builds itself from the projects: what was done and what is still open since the last meeting. Your standing items carry over.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: space.sm }}>
        <label><span style={label}>Date</span><input type="date" value={setup?.date || ''} onChange={e => setSetup(s => ({ ...s, date: e.target.value }))} style={field} aria-label="Meeting date" /></label>
        <label><span style={label}>Time</span><input value={setup?.time || ''} onChange={e => setSetup(s => ({ ...s, time: e.target.value }))} placeholder="12:00pm – 1:30pm" style={field} aria-label="Meeting time" /></label>
        <label style={{ gridColumn: '1 / -1' }}><span style={label}>Location</span><input value={setup?.location ?? ''} onChange={e => setSetup(s => ({ ...s, location: e.target.value }))} style={field} aria-label="Location" /></label>
      </div>
      <div style={{ display: 'flex', gap: space.xs, marginTop: space.sm }}>
        <button type="button" onClick={startMeeting} disabled={!setup?.date || busy === 'setup'} style={btn(true)}>{busy === 'setup' ? 'Building…' : 'Build the agenda'}</button>
        {agenda && <button type="button" onClick={() => setSetup(null)} style={btn(false)}>Cancel</button>}
      </div>
    </div>
  )

  const doc = agenda && (
    <div data-agenda-view>
      <div style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md }}>
        <div style={{ ...text('title'), color: colour.ink }}>{agenda.title}</div>
        {[['Date', dmy(agenda.date)], ['Time', agenda.time], ['Location', agenda.location], ['Chair', agenda.chair], ['Attendees', agenda.attendees], ['Apologies', agenda.apologies]]
          .filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ ...text('body'), color: colour.inkMuted, marginTop: 2 }}><b style={{ color: colour.ink }}>{k}:</b> {v}</div>
          ))}
      </div>

      {actions && (
        <div data-agenda-actions style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md, marginTop: space.sm }}>
          <div style={{ ...text('heading'), color: colour.ink }}>Actions since {actions.since?.title}{actions.since?.date ? ` · ${short(actions.since.date)}` : ''}</div>
          <div style={{ ...text('caption'), color: colour.inkFaint }}>From the projects page — tick tasks there and this updates.</div>
          <div style={{ ...text('bodyStrong'), color: colour.accentDeep, marginTop: space.sm }}>Completed · {actions.done.length}</div>
          {actions.done.map((t, i) => (
            <div key={`d${i}`} data-agenda-done style={{ ...text('body'), color: colour.ink, display: 'flex', gap: space.xs, padding: '3px 0', borderBottom: border.hairlineSoft }}>
              <span style={{ color: colour.accent }}>✓</span><span style={{ flex: 1, minWidth: 0 }}>{t.task}</span>
              <span style={{ ...text('caption'), color: colour.inkFaint, whiteSpace: 'nowrap' }}>{first(t.assignee)}{t.doneOn ? ` · ${short(t.doneOn)}` : ''}</span>
            </div>
          ))}
          {actions.alsoDone?.length > 0 && <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 4 }}>Also completed: {actions.alsoDone.length} other task{actions.alsoDone.length === 1 ? '' : 's'}.</div>}
          <div style={{ ...text('bodyStrong'), color: colour.danger, marginTop: space.sm }}>Not completed · {actions.notDone.length}</div>
          {actions.notDone.map((t, i) => (
            <div key={`n${i}`} data-agenda-notdone style={{ ...text('body'), color: colour.ink, display: 'flex', gap: space.xs, padding: '3px 0', borderBottom: border.hairlineSoft }}>
              <span style={{ color: t.overdue ? colour.danger : colour.inkFainter }}>○</span><span style={{ flex: 1, minWidth: 0 }}>{t.task}</span>
              <span style={{ ...text('caption'), color: t.overdue ? colour.danger : colour.inkFaint, whiteSpace: 'nowrap' }}>{first(t.assignee)}{t.due_date ? ` · ${t.overdue ? 'overdue ' : 'due '}${short(t.due_date)}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      <div style={sectionHead}>Items for discussion</div>
      {items.map((it, i) => (
        editItem?.index === i ? (
          <div key={it.id || i} style={{ background: colour.surface, border: `1px solid ${colour.accent}`, borderRadius: radius.control, padding: space.sm, marginTop: space.xs }}>
            <input value={editItem.title} onChange={e => setEditItem(x => ({ ...x, title: e.target.value }))} style={field} aria-label="Item" />
            <textarea value={editItem.points} onChange={e => setEditItem(x => ({ ...x, points: e.target.value }))} rows={3} placeholder="Discussion points — one per line" style={{ ...field, marginTop: space.xs, resize: 'vertical' }} />
            <input value={editItem.lead} onChange={e => setEditItem(x => ({ ...x, lead: e.target.value }))} placeholder="Lead" style={{ ...field, marginTop: space.xs }} />
            <div style={{ display: 'flex', gap: space.xs, marginTop: space.xs }}>
              <button type="button" style={btn(true)} onClick={() => { withItems(items.map((x, j) => (j === i ? { ...x, title: editItem.title, points: editItem.points.split('\n').map(s => s.trim()).filter(Boolean), lead: editItem.lead } : x))); setEditItem(null) }}>Save</button>
              <button type="button" style={btn(false)} onClick={() => setEditItem(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={it.id || i} data-agenda-item style={{ display: 'flex', gap: space.sm, background: colour.surface, border: border.hairline, borderRadius: radius.control, padding: space.sm, marginTop: space.xs }}>
            <span style={{ ...text('heading'), color: colour.accentDeep, minWidth: 22 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...text('bodyStrong'), color: colour.ink }}>{it.title}{it.lead ? <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}> · {it.lead}</span> : null}</div>
              {(it.points || []).map((p, j) => <div key={j} style={{ ...text('body'), color: colour.inkMuted }}>• {p}</div>)}
            </div>
            {canEdit && (
              <div data-no-print style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                <button type="button" style={small} aria-label="Edit item" onClick={() => setEditItem({ index: i, title: it.title, points: (it.points || []).join('\n'), lead: it.lead || '' })}>✎</button>
                <button type="button" style={small} aria-label="Move up" onClick={() => move(i, -1)}>↑</button>
                <button type="button" style={small} aria-label="Move down" onClick={() => move(i, 1)}>↓</button>
                <button type="button" style={{ ...small, color: colour.danger }} aria-label="Take off" onClick={() => withItems(items.filter((_, j) => j !== i))}>✕</button>
              </div>
            )}
          </div>
        )
      ))}
      {canEdit && (
        <div data-no-print style={{ display: 'flex', gap: space.xs, marginTop: space.sm }}>
          <input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Add an item…" aria-label="Add an item" style={{ ...field, flex: 1 }}
            onKeyDown={e => { if (e.key === 'Enter' && newItem.trim()) { withItems([...items, { title: newItem.trim(), points: [], lead: '' }]); setNewItem('') } }} />
          <button type="button" style={btn(false)} disabled={!newItem.trim()} onClick={() => { withItems([...items, { title: newItem.trim(), points: [], lead: '' }]); setNewItem('') }}>Add</button>
        </div>
      )}
      {agenda.updatedAt && (
        <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: space.sm }}>
          Updated {new Date(agenda.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{agenda.updatedBy ? ` by ${agenda.updatedBy}` : ''}
        </div>
      )}
    </div>
  )

  const chatPanel = canEdit && agenda && (
    <div data-agenda-chat data-no-print style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md, display: 'flex', flexDirection: 'column', gap: space.sm, ...(wide ? { position: 'sticky', top: space.md, maxHeight: 'calc(100vh - 120px)' } : { marginTop: space.md }) }}>
      <div style={{ ...text('heading'), color: colour.ink }}>Ask Claude</div>
      <div style={{ ...text('caption'), color: colour.inkFaint }}>It knows the report and your earlier agendas, and changes the agenda as you talk. Undo puts the last change back.</div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: space.xs, minHeight: wide ? 120 : 0 }}>
        {chat.length === 0 && STARTERS.map(s => (
          <button key={s} type="button" onClick={() => (s.endsWith(': ') ? setSaid(s) : ask(s))}
            style={{ ...text('caption'), textAlign: 'left', padding: `${space.xs}px ${space.sm}px`, borderRadius: radius.control, border: border.hairline, background: colour.canvas, color: colour.ink, cursor: 'pointer' }}>{s}</button>
        ))}
        {chat.map((m, i) => (
          <div key={i} data-chat-role={m.role} style={{ ...text('body'), alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%',
            background: m.role === 'user' ? colour.accentSoft : m.failed ? colour.dangerSoft : colour.canvas, color: colour.ink,
            borderRadius: radius.control, padding: `${space.xs}px ${space.sm}px`, whiteSpace: 'pre-wrap' }}>{m.text}</div>
        ))}
        {busy === 'chat' && <div style={{ ...text('caption'), color: colour.inkFaint }}>Claude is working on it…</div>}
        <div ref={chatEnd} />
      </div>
      <div style={{ display: 'flex', gap: space.xs }}>
        <input value={said} onChange={e => setSaid(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask() }}
          placeholder="e.g. add the Christmas roster, led by Erin" aria-label="Message Claude" style={{ ...field, flex: 1 }} />
        <button type="button" onClick={() => ask()} disabled={busy === 'chat' || !said.trim()} style={btn(true)}>Send</button>
      </div>
      {undo && <button type="button" onClick={() => { const back = undo; setUndo(null); save(back, 'Last change undone.') }} style={{ ...btn(false), alignSelf: 'flex-start' }}>Undo last change</button>}
    </div>
  )

  return (
    <Overlay>
      <div role="dialog" aria-label="Meeting agenda" data-meeting-report style={{
        position: 'fixed', inset: 0, zIndex: 3500, background: colour.canvas, overflowY: 'auto', overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}>
        <div style={{ maxWidth: wide && canEdit ? 1180 : 760, margin: '0 auto', padding: space.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
            <div style={{ ...text('title'), color: colour.ink, flex: 1 }}>Next meeting agenda</div>
            <button type="button" onClick={onClose} aria-label="Close" style={btn(false)}>✕</button>
          </div>
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger }}>{error}</div>}
          {!data && !error && <div style={{ ...text('body'), color: colour.inkFaint }}>Loading…</div>}

          {data && agenda && (
            <div data-no-print style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginBottom: space.md }}>
              <button type="button" onClick={download} style={btn(true)}>Download Word</button>
              <button type="button" onClick={() => window.print()} style={btn(false)}>Print</button>
              <button type="button" onClick={copy} style={btn(false)}>Copy</button>
              {canEdit && !setup && <button type="button" onClick={() => setSetup({ date: '', time: agenda.time || '', location: agenda.location || '' })} style={btn(false)}>New meeting</button>}
              {canEdit && <button type="button" onClick={importPast} disabled={Boolean(busy)} style={btn(false)}>
                {busy === 'import' ? 'Reading your email…' : `Import past agendas${data.past?.length ? ` (${data.past.length} in)` : ''}`}
              </button>}
            </div>
          )}
          {note && <div role="status" style={{ ...text('caption'), color: colour.accentDeep, marginBottom: space.sm }}>{note}</div>}

          {data && canEdit && (setup || !agenda || due) && (setup ? setupCard : (
            <div data-no-print style={{ background: colour.accentSoft, borderRadius: radius.card, padding: space.md, marginBottom: space.md, display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ ...text('body'), color: colour.ink, flex: 1, minWidth: 200 }}>{agenda ? 'This agenda is for a meeting that has passed.' : 'No agenda yet.'} Set the date and time of the next meeting and it builds itself.</div>
              <button type="button" onClick={() => setSetup({ date: '', time: agenda?.time || '', location: agenda?.location || '' })} style={btn(true)}>Set up the next meeting</button>
            </div>
          ))}

          {data && !agenda && !canEdit && <div style={{ ...text('body'), color: colour.inkFaint }}>Erin has not put the next agenda up yet.</div>}

          {agenda && (wide && canEdit ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: space.md, alignItems: 'start' }}>
              {doc}{chatPanel}
            </div>
          ) : <>{doc}{chatPanel}</>)}
        </div>
      </div>
    </Overlay>
  )
}
