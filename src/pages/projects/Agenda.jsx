import React, { useCallback, useEffect, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { useLiveRefresh } from '../../liveRefresh.js'

// ─── The next meeting's agenda (Brent, 11 Nov 2026) ──────────────────────────
// "A live document that anyone can see at any moment and would live in the
// projects page" — and "just Erin to edit". Everyone sees the same agenda,
// refreshed every minute while open; Erin edits it in place, drafts it from
// her earlier agendas and the work since the last meeting (api/_agenda.js),
// and imports those earlier agendas from the Word documents she emailed Brent.

const dmy = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Hobart' }) : '')

/** The agenda as plain text, numbered as Erin numbers it. Pure. */
export function agendaText(a) {
  if (!a) return ''
  const head = [a.title, a.date && `Date: ${dmy(a.date)}`, a.time && `Time: ${a.time}`, a.location && `Location: ${a.location}`,
    a.attendees && `Attendees: ${a.attendees}`, a.apologies && `Apologies: ${a.apologies}`, a.chair && `Chair: ${a.chair}`].filter(Boolean)
  const items = (a.items || []).map((it, i) => [`${i + 1}. ${it.title}${it.lead ? ` — ${it.lead}` : ''}`, ...(it.points || []).map(p => `   • ${p}`)].join('\n'))
  return [...head, '', ...items].join('\n')
}

async function agendaWord(a) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = await import('docx')
  const run = (t, o = {}) => new TextRun({ text: t, font: 'Arial', ...o })
  const p = (t, o = {}, r = {}) => new Paragraph({ children: [run(t, r)], ...o })
  const cell = (children, w) => new TableCell({ children, width: { size: w, type: WidthType.PERCENTAGE } })
  const head = [['Date', dmy(a.date)], ['Time', a.time], ['Location', a.location], ['Attendees', a.attendees], ['Apologies', a.apologies], ['Chair', a.chair]]
    .filter(([, v]) => v).map(([k, v]) => new Paragraph({ children: [run(`${k}: `, { bold: true }), run(v)] }))
  const rows = [
    new TableRow({ children: [cell([p('#', {}, { bold: true })], 6), cell([p('Item', {}, { bold: true })], 34), cell([p('Discussion points', {}, { bold: true })], 45), cell([p('Lead', {}, { bold: true })], 15)] }),
    ...(a.items || []).map((it, i) => new TableRow({ children: [
      cell([p(String(i + 1))], 6), cell([p(it.title)], 34),
      cell((it.points?.length ? it.points : ['']).map(pt => p(pt, pt ? { bullet: { level: 0 } } : {})), 45), cell([p(it.lead || '')], 15)
    ] }))
  ]
  return Packer.toBlob(new Document({ sections: [{ children: [
    p('Agenda', {}, { bold: true, size: 36 }), p(a.title, {}, { bold: true, size: 28 }), ...head, p(''),
    new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
  ] }] }))
}

export default function Agenda({ user, onClose, today }) {
  const auth = { Authorization: `Bearer ${user?.token || ''}` }
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // the agenda being edited
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/meetings/agent?action=agenda', { headers: auth })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the agenda')
      setData(body); setError('')
    } catch (err) { setError(err.message) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])
  useEffect(() => { load() }, [load])
  // Live for everyone reading it; not while Erin is mid-edit.
  useLiveRefresh(useCallback(() => { if (!editing) load() }, [editing, load]), [editing, load])

  const agenda = data?.agenda
  const canEdit = Boolean(data?.canEdit)
  const call = async (action, method, body) => {
    const res = await fetch(`/api/meetings/agent?action=${action}`, {
      method, headers: { ...auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(out.error || 'That did not work'), { out, status: res.status })
    return out
  }

  async function save() {
    setBusy('save'); setNote('')
    try {
      const { agenda: saved } = await call('agenda', 'PUT', { agenda: editing, version: agenda?.version || 0 })
      setData(d => ({ ...d, agenda: saved })); setEditing(null); setNote('Saved — everyone sees this now.')
    } catch (err) {
      if (err.status === 409 && err.out?.agenda) setData(d => ({ ...d, agenda: err.out.agenda }))
      setNote(err.message)
    }
    setBusy('')
  }
  async function draft() {
    setBusy('draft'); setNote('')
    try {
      const out = await call('agenda-draft', 'POST', { date: editing?.date || agenda?.date || '' })
      setEditing({ ...out.draft })
      setNote(`Drafted from ${out.basedOn.past} earlier agenda${out.basedOn.past === 1 ? '' : 's'}${out.basedOn.meeting ? ` and the work since ${out.basedOn.meeting.title}` : ''}. Check it, change anything, then Save.${out.draft.notes ? ` ${out.draft.notes}` : ''}`)
    } catch (err) { setNote(err.message) }
    setBusy('')
  }
  async function importPast() {
    setBusy('import'); setNote('')
    try {
      const out = await call('agenda-import', 'POST', {})
      setNote(`Read ${out.read} agenda${out.read === 1 ? '' : 's'} from email — ${out.added} new.${out.failed?.length ? ` Could not read: ${out.failed.join(', ')}.` : ''}`)
      await load()
    } catch (err) { setNote(err.message) }
    setBusy('')
  }
  async function copy() {
    try { await navigator.clipboard.writeText(agendaText(agenda)); setNote('Copied.') } catch { setNote('Could not copy on this device.') }
  }
  async function download() {
    try {
      const blob = await agendaWord(agenda)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `TechnoMed Staff Meeting Agenda ${agenda.date || today}.docx`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    } catch (err) { setNote(err.message) }
  }

  const btn = on => ({ ...text('caption'), fontWeight: 700, minHeight: 38, padding: `0 ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
    border: on ? 'none' : border.hairline, background: on ? colour.navy : colour.surface, color: on ? 'white' : colour.ink })
  const field = { ...text('field'), width: '100%', boxSizing: 'border-box', padding: `${space.xs}px ${space.sm}px`, border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink }
  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, display: 'block', marginBottom: 2 }

  const set = (k, v) => setEditing(e => ({ ...e, [k]: v }))
  const setItem = (i, k, v) => setEditing(e => ({ ...e, items: e.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)) }))
  const moveItem = (i, d) => setEditing(e => {
    const items = [...e.items]; const j = i + d
    if (j < 0 || j >= items.length) return e
    ;[items[i], items[j]] = [items[j], items[i]]
    return { ...e, items }
  })

  const view = a => (
    <div data-agenda-view>
      <div style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md }}>
        <div style={{ ...text('title'), color: colour.ink }}>{a.title}</div>
        {[['Date', dmy(a.date)], ['Time', a.time], ['Location', a.location], ['Attendees', a.attendees], ['Apologies', a.apologies], ['Chair', a.chair]]
          .filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ ...text('body'), color: colour.inkMuted, marginTop: 2 }}><b style={{ color: colour.ink }}>{k}:</b> {v}</div>
          ))}
      </div>
      {(a.items || []).map((it, i) => (
        <div key={it.id || i} data-agenda-item style={{ display: 'flex', gap: space.sm, background: colour.surface, border: border.hairline, borderRadius: radius.control, padding: space.sm, marginTop: space.xs }}>
          <span style={{ ...text('heading'), color: colour.accentDeep, minWidth: 22 }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...text('bodyStrong'), color: colour.ink }}>{it.title}</div>
            {(it.points || []).map((p, j) => <div key={j} style={{ ...text('body'), color: colour.inkMuted }}>• {p}</div>)}
          </div>
          {it.lead && <span style={{ ...text('caption'), color: colour.inkFaint, whiteSpace: 'nowrap' }}>{it.lead}</span>}
        </div>
      ))}
      {a.updatedAt && (
        <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: space.sm }}>
          Updated {new Date(a.updatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{a.updatedBy ? ` by ${a.updatedBy}` : ''}
        </div>
      )}
    </div>
  )

  const editor = e => (
    <div data-agenda-edit>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: space.sm }}>
        <label style={{ gridColumn: '1 / -1' }}><span style={label}>Title</span><input value={e.title} onChange={x => set('title', x.target.value)} style={field} /></label>
        <label><span style={label}>Date</span><input type="date" value={e.date} onChange={x => set('date', x.target.value)} style={field} /></label>
        <label><span style={label}>Time</span><input value={e.time} onChange={x => set('time', x.target.value)} placeholder="12:00pm – 1:30pm" style={field} /></label>
        <label><span style={label}>Chair</span><input value={e.chair} onChange={x => set('chair', x.target.value)} style={field} /></label>
        <label style={{ gridColumn: '1 / -1' }}><span style={label}>Location</span><input value={e.location} onChange={x => set('location', x.target.value)} style={field} /></label>
        <label style={{ gridColumn: '1 / -1' }}><span style={label}>Attendees</span><input value={e.attendees} onChange={x => set('attendees', x.target.value)} style={field} /></label>
        <label style={{ gridColumn: '1 / -1' }}><span style={label}>Apologies</span><input value={e.apologies} onChange={x => set('apologies', x.target.value)} style={field} /></label>
      </div>
      {e.items.map((it, i) => (
        <div key={it.id || i} style={{ background: colour.surface, border: border.hairline, borderRadius: radius.control, padding: space.sm, marginTop: space.sm }}>
          <div style={{ display: 'flex', gap: space.xs, alignItems: 'center' }}>
            <span style={{ ...text('heading'), color: colour.accentDeep, minWidth: 22 }}>{i + 1}</span>
            <input value={it.title} onChange={x => setItem(i, 'title', x.target.value)} placeholder="Item" style={{ ...field, flex: 1 }} aria-label={`Item ${i + 1}`} />
            <button type="button" onClick={() => moveItem(i, -1)} aria-label="Move up" style={btn(false)}>↑</button>
            <button type="button" onClick={() => moveItem(i, 1)} aria-label="Move down" style={btn(false)}>↓</button>
            <button type="button" onClick={() => setEditing(x => ({ ...x, items: x.items.filter((_, j) => j !== i) }))} aria-label="Take off" style={{ ...btn(false), color: colour.danger }}>✕</button>
          </div>
          <textarea value={(it.points || []).join('\n')} onChange={x => setItem(i, 'points', x.target.value.split('\n'))}
            placeholder="Discussion points — one per line" rows={Math.max(2, (it.points || []).length + 1)} style={{ ...field, marginTop: space.xs, resize: 'vertical' }} />
          <input value={it.lead} onChange={x => setItem(i, 'lead', x.target.value)} placeholder="Lead" style={{ ...field, marginTop: space.xs }} />
        </div>
      ))}
      <button type="button" onClick={() => setEditing(x => ({ ...x, items: [...x.items, { id: `n${Date.now()}`, title: '', points: [], lead: '' }] }))}
        style={{ ...btn(false), marginTop: space.sm }}>+ Add an item</button>
    </div>
  )

  const blank = { title: 'TechnoMed Staff Meeting', date: '', time: '', location: 'TechnoMed office, 295 Elizabeth Street, North Hobart, and Google Meet', chair: 'Erin Smallbon', attendees: '', apologies: '', items: [], notes: '' }

  return (
    <Overlay>
      <div role="dialog" aria-label="Meeting agenda" data-meeting-report style={{
        position: 'fixed', inset: 0, zIndex: 3500, background: colour.canvas, overflowY: 'auto', overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: space.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, marginBottom: space.sm }}>
            <div style={{ ...text('title'), color: colour.ink, flex: 1 }}>Next meeting agenda</div>
            <button type="button" onClick={onClose} aria-label="Close" style={btn(false)}>✕</button>
          </div>
          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger }}>{error}</div>}
          {!data && !error && <div style={{ ...text('body'), color: colour.inkFaint }}>Loading…</div>}

          {data && (
            <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginBottom: space.md }}>
              {editing ? <>
                <button type="button" onClick={save} disabled={Boolean(busy)} style={btn(true)}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={draft} disabled={Boolean(busy)} style={btn(false)}>{busy === 'draft' ? 'Drafting…' : 'Draft it for me'}</button>
                <button type="button" onClick={() => { setEditing(null); setNote('') }} style={btn(false)}>Cancel</button>
              </> : <>
                {canEdit && <button type="button" onClick={() => setEditing({ ...(agenda || blank), items: [...(agenda?.items || [])] })} style={btn(true)}>{agenda ? 'Edit' : 'Start the agenda'}</button>}
                {agenda && <button type="button" onClick={copy} style={btn(false)}>Copy</button>}
                {agenda && <button type="button" onClick={download} style={btn(false)}>Download Word</button>}
                {canEdit && <button type="button" onClick={importPast} disabled={Boolean(busy)} style={btn(false)}>
                  {busy === 'import' ? 'Reading your email…' : `Import past agendas${data.past?.length ? ` (${data.past.length} in)` : ''}`}
                </button>}
              </>}
            </div>
          )}
          {note && <div role="status" style={{ ...text('caption'), color: colour.accentDeep, marginBottom: space.sm }}>{note}</div>}

          {editing ? editor(editing) : agenda ? view(agenda) : data && (
            <div style={{ ...text('body'), color: colour.inkFaint }}>
              {canEdit ? 'No agenda yet. Import your past agendas, then Start the agenda and Draft it for me.' : 'Erin has not put the next agenda up yet.'}
            </div>
          )}
        </div>
      </div>
    </Overlay>
  )
}
