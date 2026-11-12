import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border, face } from '../../design/tokens.js'
import { useLiveRefresh } from '../../liveRefresh.js'
import { useIsDesktop } from '../../design/viewport.js'
import { STAFF } from '../../staffConfig.js'
import { orderedItems, isWelcome, isGeneral, isNextMeeting } from '../../projects/agendaOrder.js'

// ─── The next meeting's agenda (Brent, 11 and 12 Nov 2026) ───────────────────
// "The agendas [should] be written based off the projects completed report …
// a section for the items that are not completed, so we don't waste time
// asking staff to tell us about the things we thought weren't done. Ideally,
// Erin would tell the portal the date and time of the meeting and the agenda
// would build as an exportable and printable file and Erin could add items …
// a Claude chat … to build the agenda from scratch using the data in the
// projects report."
//
// So: the agenda is the document as it will print — header, then the actions
// not yet completed (worked out from the projects every time, never typed),
// then Erin's numbered items. The Claude chat was removed (Brent, 12 Nov
// 2026: "Get rid of the bot and give us an alternative way to edit easily"):
// Erin picks the date and time, taps who is coming, taps items on from the
// projects and the last agenda, and edits any item in place. Every change
// saves at once. Everyone reads it live; only Erin (AGENDA_EDITORS) changes
// it. Word and Print for everyone.

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

// ─── The Word export (Brent, 12 Nov 2026: "the formatting is very poor … This
// is what we want the format to look like") ──────────────────────────────────
// Copied from Erin's own agenda document: Montserrat 9pt grey body, A4 with
// her margins, a "TechnoMed | Surgical Solutions & Support" header ruled in
// teal, the address footer with page numbers, a details table with grey label
// cells, the agenda table under a navy heading row with a teal band naming the
// meeting, teal round bullets, and an empty "Actions arising" table to fill in.
export const WORD = { navy: '182A46', teal: '0D6475', bullet: '00957F', label: 'E2E2E2', ink: '555555', rule: 'BFBFBF', font: 'Montserrat' }

export async function agendaWordDoc(a, actions) {
  const {
    Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, Header, Footer,
    TabStopType, PageNumber, LevelFormat, AlignmentType
  } = await import('docx')
  const W = WORD
  const run = (t, o = {}) => new TextRun({ text: String(t ?? ''), font: W.font, size: 18, color: W.ink, ...o })
  const para = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { after: 40 }, ...o })
  const bullet = t => para(run(t), { numbering: { reference: 'tm-dots', level: 0 }, spacing: { after: 20 } })
  const line = { style: BorderStyle.SINGLE, size: 4, color: W.rule }
  const borders = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line }
  const margins = { top: 70, bottom: 70, left: 110, right: 110 }
  const cell = (children, width, o = {}) => new TableCell({
    children: Array.isArray(children) ? children : [children], width: { size: width, type: WidthType.DXA }, margins, ...o
  })
  const shade = fill => ({ shading: { type: ShadingType.CLEAR, color: 'auto', fill } })
  const headCell = (t, w) => cell(para(run(t, { bold: true, color: 'FFFFFF' })), w, shade(W.navy))
  const band = (t, cols) => new TableRow({ children: [cell(para(run(t, { bold: true, color: 'FFFFFF' })), 9638, { ...shade(W.teal), columnSpan: cols })] })

  // The meeting's details, grey labels on the left.
  const details = [['Date', dmy(a.date)], ['Time', a.time], ['Location', a.location], ['Attendees', a.attendees], ['Apologies', a.apologies], ['Chair', a.chair]]
    .filter(([, v]) => v)
  const detailTable = new Table({
    width: { size: 9638, type: WidthType.DXA }, columnWidths: [2300, 7338], borders,
    rows: details.map(([k, v]) => new TableRow({ children: [
      cell(para(run(k, { bold: true, color: W.navy })), 2300, shade(W.label)),
      cell(para(run(v)), 7338)
    ] }))
  })

  // The agenda itself: #, Item, Discussion points, Lead.
  const cols = [600, 2700, 4738, 1600]
  const rows = [
    new TableRow({ tableHeader: true, children: [headCell('#', cols[0]), headCell('Item', cols[1]), headCell('Discussion points', cols[2]), headCell('Lead', cols[3])] }),
    band('Staff meeting', 4),
    ...agendaSections(a, actions).map((sec, i) => {
      const points = sec.kind === 'actions'
        ? (sec.rows.length ? sec.rows.map(t => bullet(actionLine(t))) : [para(run('None outstanding'))])
        : (sec.points?.length ? sec.points.map(bullet) : [para(run(''))])
      const lead = sec.kind === 'actions' ? [...new Set(sec.rows.map(t => first(t.assignee)).filter(Boolean))].join(', ') : (sec.lead || '')
      return new TableRow({ cantSplit: true, children: [
        cell(para(run(String(i + 1), { bold: true, color: W.navy })), cols[0]),
        cell(para(run(sec.title, { bold: true, color: W.navy })), cols[1]),
        cell(points, cols[2]),
        cell(para(run(lead)), cols[3])
      ] })
    })
  ]
  const agendaTable = new Table({ width: { size: 9638, type: WidthType.DXA }, columnWidths: cols, borders, rows })

  // Actions arising, left empty to be filled in at the meeting.
  const acols = [5338, 2150, 2150]
  const arising = new Table({
    width: { size: 9638, type: WidthType.DXA }, columnWidths: acols, borders,
    rows: [
      new TableRow({ tableHeader: true, children: [headCell('Action', acols[0]), headCell('Owner', acols[1]), headCell('Due', acols[2])] }),
      ...[0, 1, 2].map(() => new TableRow({ height: { value: 360, rule: 'atLeast' }, children: acols.map(w => cell(para(run('')), w)) }))
    ]
  })

  const heading = t => para(run(t, { bold: true, color: W.navy, size: 24 }), { spacing: { before: 240, after: 100 } })
  const right = [{ type: TabStopType.RIGHT, position: 9638 }]
  return new Document({
    creator: 'TechnoMed', title: `${a.title} agenda`,
    styles: { default: { document: { run: { font: W.font, size: 18, color: W.ink } } } },
    numbering: { config: [{ reference: 'tm-dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '●', alignment: AlignmentType.LEFT,
      style: { run: { color: W.bullet, size: 12 }, paragraph: { indent: { left: 300, hanging: 220 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, right: 1134, bottom: 1100, left: 1134, header: 708, footer: 708 } } },
      headers: { default: new Header({ children: [new Paragraph({
        tabStops: right, border: { bottom: { style: BorderStyle.SINGLE, size: 8, space: 4, color: W.bullet } },
        children: [run('TechnoMed', { bold: true, color: W.navy, size: 22 }), run('\tSurgical Solutions & Support', { color: W.teal, size: 16 })]
      })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        tabStops: right,
        children: [run('TechnoMed Pty Ltd  |  295 Elizabeth Street, North Hobart TAS 7000  |  www.technomed.com.au', { size: 14 }),
          run('\tPage ', { size: 14 }), new TextRun({ children: [PageNumber.CURRENT], font: W.font, size: 14, color: W.ink })]
      })] }) },
      children: [
        para(run('Agenda', { bold: true, color: W.navy, size: 40 }), { spacing: { after: 0 } }),
        para(run(a.title || 'TechnoMed Staff Meeting', { color: W.teal, size: 24 }), { spacing: { after: 200 } }),
        detailTable,
        heading('Agenda'),
        agendaTable,
        heading('Actions arising'),
        arising
      ]
    }]
  })
}

async function agendaWord(a, actions) {
  const { Packer } = await import('docx')
  return Packer.toBlob(await agendaWordDoc(a, actions))
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

export const TIMES = ['9:00am', '10:00am', '11:00am', '12:00pm', '1:00pm', '2:00pm', '3:00pm']
const isStanding = t => isWelcome(t) || isGeneral(t) || isNextMeeting(t)

/** The agenda with one item changed, moved, removed or added. Pure. */
export function editItems(agenda, op) {
  const items = orderedItems(agenda?.items || []).map(i => ({ ...i, points: [...(i.points || [])] }))
  const at = items.findIndex(i => i.id === op.id)
  if (op.type === 'add') return { ...agenda, items: [...items.slice(0, -1), { title: op.title, points: op.points || [], lead: op.lead || '' }, items[items.length - 1]] }
  if (at < 0) return agenda
  if (op.type === 'update') items[at] = { ...items[at], ...op.patch }
  if (op.type === 'remove' && !isStanding(items[at].title)) items.splice(at, 1)
  if (op.type === 'move') {
    const to = at + op.dir
    if (to < 0 || to >= items.length || isStanding(items[at].title) || isStanding(items[to].title)) return agenda
    ;[items[at], items[to]] = [items[to], items[at]]
  }
  return { ...agenda, items }
}

const LEADS = [...new Set(STAFF.map(s => s.firstName).filter(Boolean))]

function ItemEditor({ item, n, first: isFirst, last: isLast, onChange, onMove, onRemove, field, small }) {
  const standing = isStanding(item.title)
  const [adding, setAdding] = useState(false)
  const commit = (value, was, apply) => { const v = value.trim(); if (v !== String(was || '').trim()) apply(v) }
  const points = item.points || []
  return (
    <div data-edit-item style={{ background: colour.surface, border: border.hairline, borderRadius: radius.control, padding: space.sm, marginTop: space.xs }}>
      <div style={{ display: 'flex', gap: space.xs, alignItems: 'center' }}>
        <span style={{ ...text('heading'), color: colour.accentDeep, minWidth: 22 }}>{n}</span>
        {standing
          ? <div style={{ ...text('bodyStrong'), color: colour.ink, flex: 1 }}>{item.title}</div>
          : <input key={`t-${item.id}-${item.title}`} defaultValue={item.title} aria-label="Item title" data-item-title
              onBlur={e => commit(e.target.value, item.title, v => v && onChange({ title: v }))}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} style={{ ...field, flex: 1, fontWeight: 600 }} />}
        {!standing && <>
          <button type="button" aria-label="Move up" disabled={isFirst} onClick={() => onMove(-1)} style={small}>↑</button>
          <button type="button" aria-label="Move down" disabled={isLast} onClick={() => onMove(1)} style={small}>↓</button>
          <button type="button" aria-label="Remove item" onClick={onRemove} style={{ ...small, color: colour.danger }}>✕</button>
        </>}
      </div>
      <div style={{ paddingLeft: 30, marginTop: 6 }}>
        {points.map((p, j) => (
          <div key={`${item.id}-${j}-${p}`} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input defaultValue={p} aria-label="Discussion point" data-item-point
              onBlur={e => commit(e.target.value, p, v => onChange({ points: v ? points.map((x, k) => (k === j ? v : x)) : points.filter((_, k) => k !== j) }))}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} style={{ ...field, flex: 1 }} />
            <button type="button" aria-label="Remove point" onClick={() => onChange({ points: points.filter((_, k) => k !== j) })} style={small}>✕</button>
          </div>
        ))}
        {adding && (
          <input autoFocus aria-label="New point" placeholder="New point" data-new-point
            onBlur={e => { const v = e.target.value.trim(); setAdding(false); if (v) onChange({ points: [...points, v] }) }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setAdding(false) }}
            style={{ ...field, marginTop: 4 }} />
        )}
        <div style={{ display: 'flex', gap: space.sm, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setAdding(true)} style={{ ...small, color: colour.accentDeep, padding: '0 10px', width: 'auto' }}>+ Point</button>
          <label style={{ ...text('caption'), color: colour.inkFaint, display: 'flex', alignItems: 'center', gap: 6 }}>
            Lead
            <select value={item.lead || ''} aria-label="Lead" onChange={e => onChange({ lead: e.target.value })}
              style={{ ...field, width: 'auto', padding: '4px 8px' }}>
              <option value="">—</option>
              {[...new Set([...LEADS, ...(item.lead ? [item.lead] : [])])].map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
      </div>
    </div>
  )
}

export default function Agenda({ user, onClose, today }) {
  const auth = { Authorization: `Bearer ${user?.token || ''}` }
  const wide = useIsDesktop()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [undo, setUndo] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [pane, setPane] = useState('edit') // a phone shows one at a time
  const latest = useRef(null)
  const queue = useRef(Promise.resolve())

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
  const suggestions = data?.suggestions || []
  const canEdit = Boolean(data?.canEdit)
  useEffect(() => { latest.current = agenda || null }, [agenda])

  const took = (out, d) => ({ ...d, agenda: out.agenda, actions: out.actions ?? d.actions, suggestions: out.suggestions ?? d.suggestions })

  /** Saves a change made to the newest agenda; changes queue so none is lost. */
  function save(change, message = 'Saved.') {
    queue.current = queue.current.then(async () => {
      const cur = latest.current || {}
      const next = typeof change === 'function' ? change(cur) : change
      if (next === cur) return
      setBusy('save'); setNote('')
      try {
        const out = await call('agenda', 'PUT', { agenda: next, version: cur.version || 0 })
        setUndo(cur); latest.current = out.agenda; setData(d => took(out, d)); setNote(message)
      } catch (err) {
        if (err.status === 409 && err.out?.agenda) { latest.current = err.out.agenda; setData(d => ({ ...d, agenda: err.out.agenda })) }
        setNote(err.message)
      }
      setBusy('')
    })
    return queue.current
  }
  const edit = (op, message) => save(cur => editItems(cur, op), message)

  async function newMeeting(date) {
    if (!date) return
    const cur = latest.current
    // Same meeting, new day: just the date. A meeting that has passed: a fresh
    // agenda for the new one — standing items kept, the rest offered to tap.
    if (cur?.date && cur.date >= today) return save(c => ({ ...c, date }), 'Date changed.')
    setBusy('save'); setNote('')
    try {
      const out = await call('agenda-setup', 'POST', { date, time: cur?.time || '', location: cur?.location || '', chair: cur?.chair || '' })
      setUndo(cur); latest.current = out.agenda; setData(d => took(out, d)); setNote('New agenda started — tap items below to add them.')
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
    ...(on ? face.navy : face.secondary) })
  const field = { ...text('body'), fontSize: 16, width: '100%', boxSizing: 'border-box', padding: `${space.xs}px ${space.sm}px`, border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink }
  const small = { ...text('caption'), fontWeight: 700, minWidth: 36, height: 36, borderRadius: radius.control, border: border.hairline, background: colour.surface, color: colour.inkMuted, cursor: 'pointer', flexShrink: 0 }
  const chip = state => ({
    ...text('caption'), fontWeight: 600, minHeight: 36, padding: `0 ${space.sm}px`, borderRadius: radius.pill, cursor: 'pointer',
    border: state === 'going' || state === 'on' ? `1px solid ${colour.accent}` : state === 'away' ? `1px solid ${colour.dangerLine}` : border.hairline,
    background: state === 'going' || state === 'on' ? colour.accentSoft : state === 'away' ? colour.dangerSoft : state === 'all' ? colour.canvas : colour.surface,
    color: state === 'going' || state === 'on' ? colour.accentDeep : state === 'away' ? colour.danger : colour.ink
  })
  const card = { background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md }
  const label = { ...text('caption'), fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: colour.inkFaint, marginBottom: 6 }

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
        {agenda.date && agenda.date < today && <div data-no-print style={{ ...text('caption'), color: colour.warning, marginTop: space.xs }}>This was for a meeting that has passed{canEdit ? ' — pick the next date to start a new one.' : '.'}</div>}
      </div>

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
    <div style={{ ...text('body'), color: colour.inkFaint }}>{canEdit ? 'No agenda yet — pick the meeting date to start one.' : 'Erin has not put the next agenda up yet.'}</div>
  )

  // ── Erin's editor: all taps, typing only for something new ──
  const items = orderedItems(agenda?.items || [])
  const sections = agenda ? agendaSections(agenda, actions) : []
  const numberOf = id => sections.findIndex(s => s.kind === 'item' && s.id === id) + 1
  const movable = items.filter(i => !isStanding(i.title))
  const addNew = () => { const t = newTitle.trim(); if (!t) return; setNewTitle(''); edit({ type: 'add', title: t }, `Added "${t}".`) }
  const editor = canEdit && (
    <div data-agenda-editor data-no-print style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
      <div style={card}>
        <div style={label}>The meeting</div>
        <input type="date" aria-label="Meeting date" value={agenda?.date || ''} onChange={e => newMeeting(e.target.value)} style={{ ...field, maxWidth: 220 }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: space.xs }}>
          {[...new Set([...TIMES, ...(agenda?.time && !TIMES.includes(agenda.time) ? [agenda.time] : [])])].map(t => (
            <button key={t} type="button" aria-pressed={agenda?.time === t} data-time={t}
              onClick={() => save(c => ({ ...c, time: t }), `Time set to ${t}.`)} style={chip(agenda?.time === t ? 'on' : '')}>{t}</button>
          ))}
        </div>
        <input key={`loc-${agenda?.version || 0}`} defaultValue={agenda?.location || ''} aria-label="Location" placeholder="Location (e.g. TechnoMed office and Google Meet)"
          onBlur={e => { const v = e.target.value.trim(); if (v !== (agenda?.location || '')) save(c => ({ ...c, location: v }), 'Location saved.') }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} style={{ ...field, marginTop: space.xs }} />
      </div>

      {agenda && (
        <div style={card}>
          <div style={label}>Who is coming</div>
          <WhoIsComing value={{ attendees: agenda.attendees, apologies: agenda.apologies }}
            onChange={v => save(c => ({ ...c, ...v }))} chip={chip} field={field} />
        </div>
      )}

      {agenda && suggestions.length > 0 && (
        <div style={card} data-agenda-suggestions>
          <div style={label}>Tap to add</div>
          {suggestions.map(sug => (
            <button key={sug.key} type="button" data-suggestion={sug.kind}
              onClick={() => edit({ type: 'add', title: sug.title, points: sug.points, lead: sug.lead }, `Added "${sug.title}".`)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: space.sm, width: '100%', textAlign: 'left', padding: `${space.xs}px 0`, border: 'none', borderBottom: border.hairlineSoft, background: 'none', cursor: 'pointer' }}>
              <span style={{ ...text('heading'), color: colour.accent, lineHeight: 1 }}>+</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>{sug.title}{sug.lead ? <span style={{ ...text('caption'), color: colour.inkFaint, fontWeight: 400 }}> · {sug.lead}</span> : null}</span>
                <span style={{ ...text('caption'), color: colour.inkFaint }}>{sug.note}{sug.points?.length ? ` — ${sug.points.slice(0, 2).join('; ')}${sug.points.length > 2 ? '…' : ''}` : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {agenda && (
        <div style={card}>
          <div style={label}>Items — tap any wording to change it</div>
          {items.map(it => (
            <React.Fragment key={it.id}>
              <ItemEditor item={it} n={numberOf(it.id)} field={field} small={small}
                first={movable[0]?.id === it.id} last={movable[movable.length - 1]?.id === it.id}
                onChange={patch => edit({ type: 'update', id: it.id, patch })}
                onMove={dir => edit({ type: 'move', id: it.id, dir }, 'Moved.')}
                onRemove={() => edit({ type: 'remove', id: it.id }, `Removed "${it.title}".`)} />
              {isGeneral(it.title) && (
                <div style={{ ...text('caption'), color: colour.inkFaint, padding: `${space.xs}px ${space.sm}px`, marginTop: space.xs, border: `1px dashed ${colour.line}`, borderRadius: radius.control }}>
                  {numberOf(it.id) + 1}. Actions not yet completed — filled in from the projects page
                </div>
              )}
            </React.Fragment>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: space.sm }}>
            <input value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addNew() }}
              placeholder="Something else to discuss" aria-label="New item" style={{ ...field, flex: 1 }} />
            <button type="button" onClick={addNew} disabled={!newTitle.trim()} style={btn(true)}>Add</button>
          </div>
          {undo && <button type="button" onClick={() => { const back = undo; setUndo(null); save(c => ({ ...back, version: c.version }), 'Last change undone.') }}
            style={{ ...btn(false), marginTop: space.sm }}>Undo last change</button>}
        </div>
      )}
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
            {busy === 'save' && <span style={{ ...text('caption'), color: colour.inkFaint }}>Saving…</span>}
            <button type="button" onClick={onClose} aria-label="Close" style={btn(false)}>✕</button>
          </div>
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger }}>{error}</div>}
          {!data && !error && <div style={{ ...text('body'), color: colour.inkFaint }}>Loading…</div>}
          {note && <div role="status" style={{ ...text('caption'), color: colour.accentDeep, marginBottom: space.sm }}>{note}</div>}

          {data && (canEdit && wide ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: space.md, alignItems: 'start' }}>
              {editor}<div>{doc}</div>
            </div>
          ) : canEdit ? (
            <>
              <div data-no-print role="tablist" style={{ display: 'flex', borderBottom: border.hairline, marginBottom: space.sm }}>
                {[['edit', 'Edit'], ['agenda', 'Agenda']].map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={pane === k} onClick={() => setPane(k)}
                    style={{ ...text('bodyStrong'), flex: 1, minHeight: 44, border: 'none', background: 'none', cursor: 'pointer',
                      color: pane === k ? colour.ink : colour.inkFaint, borderBottom: pane === k ? `3px solid ${colour.accent}` : '3px solid transparent' }}>{l}</button>
                ))}
              </div>
              {pane === 'edit' ? editor : doc}
            </>
          ) : doc)}
        </div>
      </div>
    </Overlay>
  )
}
