import React, { useEffect, useMemo, useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { meetingReport, reportText } from '../../projects/report.js'

// ─── Meeting report (Brent, 11 Nov 2026) ─────────────────────────────────────
// "When Erin prepares for the next meeting a month later, she needs to be able
// to produce a report of all of the items that were completed and all of the
// items that are still outstanding." Pick the meeting the period starts from
// (the last one, by default) and the day it runs to (today); the report is
// worked out from the worklist already on screen (src/projects/report.js).
// Copy puts it on the clipboard as text; Download saves it as a Word document
// to edit into the agenda; Print is the browser's own (and its Save as PDF).

const dmy = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Hobart' }) : '')

async function wordFile(r) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')
  const run = (t, o = {}) => new TextRun({ text: t, font: 'Arial', ...o })
  const p = (children, o = {}) => new Paragraph({ children: [].concat(children), ...o })
  const lines = reportText(r).split('\n')
  const children = lines.map((l, i) => {
    if (i === 0) return p(run(l, { bold: true, size: 32 }), { heading: HeadingLevel.HEADING_1 })
    if (/^\S.*\(\d+\)$/.test(l)) return p(run(l, { bold: true, size: 26 }), { spacing: { before: 240 } })
    if (l.startsWith('• ')) return p(run(l.slice(2)), { bullet: { level: 0 } })
    return p(run(l))
  })
  return Packer.toBlob(new Document({ sections: [{ children }] }))
}

function Row({ t }) {
  return (
    <div style={{ display: 'flex', gap: space.sm, padding: `${space.xs + 2}px 0`, borderBottom: border.hairlineSoft }}>
      <span aria-hidden="true" style={{ color: t.doneOn ? colour.accent : t.overdue ? colour.danger : colour.inkFainter, fontWeight: 700 }}>
        {t.doneOn ? '✓' : '○'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...text('body'), color: colour.ink, overflowWrap: 'anywhere' }}>{t.task}</div>
        <div style={{ ...text('caption'), color: t.overdue ? colour.danger : colour.inkFaint }}>
          {[t.assignee,
            t.doneOn ? `done ${dmy(t.doneOn)}${t.doneBy && !t.assignee.startsWith(t.doneBy) ? ` by ${t.doneBy}` : ''}`
              : t.due_date ? `due ${dmy(t.due_date)}${t.overdue ? ' — overdue' : ''}` : 'no due date',
            t.earlier && t.meeting ? `from ${t.meeting}${t.meetingDate ? ` ${dmy(t.meetingDate)}` : ''}` : null
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  )
}

function Section({ title, list, note }) {
  if (!list.length) return null
  return (
    <section style={{ marginTop: space.lg }} data-report-section={title}>
      <div style={{ ...text('heading'), color: colour.ink }}>{title} · {list.length}</div>
      {note && <div style={{ ...text('caption'), color: colour.inkFaint }}>{note}</div>}
      {list.map(t => <Row key={t.id} t={t} />)}
    </section>
  )
}

export default function MeetingReport({ user, items, today, onClose }) {
  const [meetings, setMeetings] = useState(null)
  const [error, setError] = useState('')
  const [fromId, setFromId] = useState('')
  const [to, setTo] = useState(today)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    fetch('/api/meetings/agent?action=meetings', { headers: { Authorization: `Bearer ${user?.token || ''}` } })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!live) return
        if (!ok) throw new Error(b.error || 'Could not load the meetings')
        setMeetings(b.meetings || [])
        // The last meeting before today is where the period starts.
        const last = (b.meetings || []).find(m => m.date <= today) || (b.meetings || [])[0]
        if (last) setFromId(last.id)
      })
      .catch(err => live && setError(err.message))
    return () => { live = false }
  }, [user?.token, today])

  const meeting = meetings?.find(m => m.id === fromId)
  const report = useMemo(() => (meeting ? meetingReport(items, meeting, { to, today }) : null), [items, meeting, to, today])

  async function copy() {
    try { await navigator.clipboard.writeText(reportText(report)); setNote('Copied — paste it into an email or the agenda.') } catch { setNote('Could not copy on this device.') }
  }
  async function download() {
    try {
      const blob = await wordFile(report)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `Action items since ${report.meeting.title} ${report.from}.docx`.replace(/[\\/:*?"<>|]/g, ' ')
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      setNote('Downloaded.')
    } catch (err) { setNote(err.message || 'Could not make the document.') }
  }

  const btn = on => ({ ...text('caption'), fontWeight: 700, minHeight: 38, padding: `0 ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
    border: on ? 'none' : border.hairline, background: on ? colour.navy : colour.surface, color: on ? 'white' : colour.ink })
  const field = { ...text('field'), padding: `${space.xs}px ${space.sm}px`, border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink, minWidth: 0 }

  return (
    <Overlay>
      <div role="dialog" aria-label="Meeting report" data-meeting-report style={{
        position: 'fixed', inset: 0, zIndex: 3500, background: colour.canvas, overflowY: 'auto', overflowX: 'hidden',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)'
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: space.md }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
            <div style={{ ...text('title'), color: colour.ink, flex: 1 }}>Meeting report</div>
            <button type="button" onClick={onClose} aria-label="Close" style={btn(false)}>✕</button>
          </div>
          <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.md }}>
            Every action item from a meeting — what has been done and what is still outstanding.
          </div>

          {error && <div role="alert" style={{ ...text('caption'), color: colour.danger }}>{error}</div>}
          {meetings === null && !error && <div style={{ ...text('body'), color: colour.inkFaint }}>Loading the meetings…</div>}
          {meetings?.length === 0 && (
            <div style={{ ...text('body'), color: colour.inkFaint }}>
              No meeting has had its minutes sent yet. Action items come from a meeting once its minutes are sent to the team.
            </div>
          )}

          {meetings?.length > 0 && (
            <div style={{ display: 'flex', gap: space.sm, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 220px', minWidth: 0 }}>
                <span style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint }}>From the meeting</span>
                <select value={fromId} onChange={e => setFromId(e.target.value)} style={field} data-report-from>
                  {meetings.map(m => <option key={m.id} value={m.id}>{dmy(m.date)} — {m.title} ({m.items} items)</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px', minWidth: 0 }}>
                <span style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint }}>To</span>
                <input type="date" value={to} onChange={e => setTo(e.target.value || today)} style={field} />
              </label>
            </div>
          )}

          {report && (
            <div data-report>
              <div style={{ background: colour.surface, border: border.hairline, borderRadius: radius.card, padding: space.md, marginTop: space.md }}>
                <div style={{ ...text('heading'), color: colour.ink }}>
                  {report.totals.done} of {report.totals.items} done · {report.totals.open} outstanding
                  {report.totals.overdue ? <span style={{ color: colour.danger }}> · {report.totals.overdue} overdue</span> : null}
                </div>
                <div style={{ ...text('caption'), color: colour.inkFaint }}>
                  {report.meeting.title}, {dmy(report.from)} → {dmy(report.to)}
                </div>
                {report.people.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
                    {report.people.map(p => (
                      <span key={p.name} style={{ ...text('caption'), padding: '4px 10px', borderRadius: radius.pill, background: colour.lineSoft, color: colour.ink }}>
                        {p.name}: {p.done} done, {p.open} open{p.overdue ? ` (${p.overdue} overdue)` : ''}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginTop: space.md }}>
                  <button type="button" onClick={copy} style={btn(true)}>Copy</button>
                  <button type="button" onClick={download} style={btn(false)}>Download Word</button>
                  <button type="button" onClick={() => window.print()} style={btn(false)}>Print</button>
                </div>
                {note && <div role="status" style={{ ...text('caption'), color: colour.accentDeep, marginTop: space.xs }}>{note}</div>}
              </div>

              <Section title="Completed" list={report.done} />
              <Section title="Outstanding" list={report.open} />
              <Section title="Still open from earlier meetings" list={report.earlier.map(t => ({ ...t, earlier: true }))} />
              <Section title="Earlier meetings' items completed in this period" list={report.earlierDone.map(t => ({ ...t, earlier: true }))} />
              <Section title="Other tasks completed in this period" list={report.other} note="Tasks not from a meeting, finished between the two dates." />
              <Section title="Put away without being done" list={report.putAway} />
            </div>
          )}
        </div>
      </div>
    </Overlay>
  )
}
