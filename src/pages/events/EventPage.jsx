import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Banner } from '../../design/Shell.jsx'
import { useBackLayer } from '../../backButton.js'
import { colour, text, space, radius } from '../../design/tokens.js'
import { STAFF } from '../../staffConfig.js'
import {
  EVENT_KINDS, QUESTION_LIBRARY, REPLY_LABEL, GROUPS, summarise, answerText, whenText, seatsFor, showMobile
} from '../../events/model.js'
import { eventsApi, readInviteFile } from './eventsApi.js'
import Contacts from './Contacts.jsx'
import { Photo, photoForKind, seedOf, EventStyles, WASH } from './photos.jsx'

// ─── One event, for its organisers (Events, 25 Nov 2026) ────────────────────
// Sections as in the approved mock-up: Guests, Invite and details, Reply form,
// Venue and costs, Check-in. Every change saves straight away.

const TABS = [['guests', 'Guests'], ['details', 'Invite and details'], ['form', 'Reply form'], ['venue', 'Venue and costs'], ['checkin', 'Check-in']]
const btn = (primary = false) => ({
  minHeight: 40, padding: '0 14px', borderRadius: radius.control, cursor: 'pointer', ...text('bodyStrong'),
  border: primary ? 'none' : `1px solid ${colour.line}`, background: primary ? colour.accent : colour.surface,
  color: primary ? 'white' : colour.ink, whiteSpace: 'nowrap'
})
const field = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: radius.control, border: `1px solid ${colour.line}`, ...text('field'), background: colour.surface, color: colour.ink }
const lbl = { ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', display: 'block', marginBottom: 4 }
const card = { background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md }
const TONE = { yes: [colour.accentSoft, colour.accentDeep], maybe: [colour.warningSoft, colour.warning], no: [colour.lineSoft, colour.inkMuted], none: [colour.dangerSoft, colour.danger], waitlist: ['#efe8fb', '#5b2a9e'] }

/** "2026-12-04T19:00" for a datetime-local box, in Hobart. */
function localInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Hobart', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
/** A datetime-local value, read as Hobart time, to ISO. */
function fromLocalInput(v) {
  if (!v) return ''
  const guess = new Date(`${v}:00Z`)
  for (const offset of [11, 10]) {
    const d = new Date(guess.getTime() - offset * 3600e3)
    if (localInput(d.toISOString()) === v) return d.toISOString()
  }
  return guess.toISOString()
}

function Details({ event, onSave, api, onUploaded }) {
  const [e, setE] = useState(event)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const fileInput = useRef(null)
  useEffect(() => setE(event), [event])
  const set = (k, v) => setE(x => ({ ...x, [k]: v }))
  const organiserChoices = STAFF.filter(s => s.email)
  async function upload(file) {
    setBusy('upload'); setError('')
    try { onUploaded((await api.invite(event.id, await readInviteFile(file))).event) } catch (err) { setError(err.message) } finally { setBusy('') }
  }
  async function preview() {
    try { const { url } = await api.inviteLink(event.id); window.open(url, '_blank', 'noopener') } catch (err) { setError(err.message) }
  }
  return (
    <div style={{ display: 'grid', gap: space.md, maxWidth: 640 }}>
      <div style={card}>
        <span style={lbl}>The invite</span>
        <div style={{ ...text('body'), color: colour.inkMuted, marginBottom: 8 }}>
          {event.invite ? `Uploaded (${event.invite.kind === 'pdf' ? 'PDF' : 'picture'}) — it sits at the top of every guest's page.` : 'No invite uploaded — guests see a TechnoMed design with the title, date and venue.'}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={btn(true)} disabled={busy === 'upload'} onClick={() => fileInput.current?.click()}>{busy === 'upload' ? 'Uploading…' : event.invite ? 'Replace the invite' : 'Upload the invite (picture or PDF)'}</button>
          {event.invite && <button type="button" style={btn()} onClick={preview}>View it</button>}
          <input ref={fileInput} type="file" accept="image/*,application/pdf" hidden style={{ fontSize: 16 }} onChange={x => x.target.files[0] && upload(x.target.files[0])} />
        </div>
      </div>
      <label><span style={lbl}>Title</span><input value={e.title || ''} onChange={x => set('title', x.target.value)} style={field} /></label>
      <div>
        <span style={lbl}>Kind of event</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{EVENT_KINDS.map(k => <button key={k.id} type="button" aria-pressed={e.kind === k.id} onClick={() => set('kind', k.id)} style={{ ...btn(e.kind === k.id), minHeight: 34, background: e.kind === k.id ? colour.navy : colour.surface }}>{k.label}</button>)}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: space.md }}>
        <label><span style={lbl}>Starts</span><input type="datetime-local" value={localInput(e.start)} onChange={x => set('start', fromLocalInput(x.target.value))} style={field} /></label>
        <label><span style={lbl}>Ends</span><input type="datetime-local" value={localInput(e.end)} onChange={x => set('end', fromLocalInput(x.target.value))} style={field} /></label>
        <label><span style={lbl}>Reply by</span><input type="datetime-local" value={localInput(e.replyBy)} onChange={x => set('replyBy', fromLocalInput(x.target.value))} style={field} /></label>
        <label><span style={lbl}>Places (0 = no limit)</span><input type="number" min="0" value={e.capacity || 0} onChange={x => set('capacity', Number(x.target.value))} style={field} /></label>
      </div>
      <label><span style={lbl}>Venue</span><input value={e.venue || ''} onChange={x => set('venue', x.target.value)} style={field} /></label>
      <label><span style={lbl}>Address</span><input value={e.address || ''} onChange={x => set('address', x.target.value)} style={field} /></label>
      <label><span style={lbl}>Map link (Google Maps "Share" link)</span><input value={e.mapUrl || ''} onChange={x => set('mapUrl', x.target.value)} placeholder="https://maps.app.goo.gl/…" style={field} /></label>
      <label><span style={lbl}>Dress</span><input value={e.dress || ''} onChange={x => set('dress', x.target.value)} placeholder="Smart casual" style={field} /></label>
      <label><span style={lbl}>Details on the guest page (agenda, speakers, parking…)</span><textarea rows={5} value={e.details || ''} onChange={x => set('details', x.target.value)} style={{ ...field, resize: 'vertical' }} /></label>
      <label><span style={lbl}>The invitation email's opening line</span><textarea rows={2} value={e.message || ''} onChange={x => set('message', x.target.value)} placeholder={`You're invited to ${e.title || 'our event'}.`} style={{ ...field, resize: 'vertical' }} /></label>
      <label><span style={lbl}>Hosted by (shown on the guest page)</span><input value={e.hostLine || ''} onChange={x => set('hostLine', x.target.value)} placeholder="Hosted by TechnoMed and Signus" style={field} /></label>
      <div>
        <span style={lbl}>Organisers (they can see and run this event)</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {organiserChoices.map(s => {
            const on = (e.organisers || []).includes(s.email.toLowerCase())
            return <button key={s.email} type="button" aria-pressed={on} style={{ ...btn(on), minHeight: 34, background: on ? colour.navy : colour.surface }}
              onClick={() => set('organisers', on ? e.organisers.filter(o => o !== s.email.toLowerCase()) : [...(e.organisers || []), s.email.toLowerCase()])}>{s.firstName}</button>
          })}
        </div>
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
      <button type="button" data-save-event disabled={busy === 'save'} style={btn(true)} onClick={async () => { setBusy('save'); setError(''); try { await onSave(e) } catch (err) { setError(err.message) } finally { setBusy('') } }}>
        {busy === 'save' ? 'Saving…' : 'Save details'}
      </button>
    </div>
  )
}

function FormBuilder({ event, onSave }) {
  const [form, setForm] = useState(event.form || [])
  const [error, setError] = useState('')
  useEffect(() => setForm(event.form || []), [event])
  const on = id => form.some(q => q.id === id)
  const save = async next => { setForm(next); setError(''); try { await onSave({ ...event, form: next }) } catch (err) { setError(err.message) } }
  const toggle = q => save(on(q.id) ? form.filter(x => x.id !== q.id) : [...form, { ...q }])
  const edit = (i, change) => setForm(f => f.map((q, j) => (j === i ? { ...q, ...change } : q)))
  const move = (i, d) => { const f = [...form]; const [q] = f.splice(i, 1); f.splice(Math.max(0, Math.min(f.length, i + d)), 0, q); save(f) }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: space.lg, alignItems: 'start' }}>
      <div style={card}>
        <span style={lbl}>Tap to add or remove</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {QUESTION_LIBRARY.map(q => (
            <button key={q.id} type="button" data-library={q.id} aria-pressed={on(q.id)} onClick={() => toggle(q)}
              style={{ ...btn(false), textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, background: on(q.id) ? colour.accentSoft : colour.surface, borderColor: on(q.id) ? colour.accent : colour.line }}>
              <span aria-hidden="true">{on(q.id) ? '✓' : '+'}</span>{q.label}
            </button>
          ))}
          <button type="button" style={btn()} onClick={() => save([...form, { id: `own${Date.now().toString(36)}`, label: 'Your question', type: 'text' }])}>+ Your own question</button>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <span style={lbl}>On this event's form</span>
        <div style={{ ...card, ...text('bodyStrong') }}>Can you come? (Yes · Maybe · Can't make it) — always asked</div>
        {form.map((q, i) => (
          <div key={q.id} data-form-question={q.id} style={{ ...card, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input aria-label="Question wording" value={q.label} onChange={x => edit(i, { label: x.target.value })} onBlur={() => save(form)} style={{ ...field, flex: 1 }} />
              <button type="button" aria-label="Move up" onClick={() => move(i, -1)} style={{ ...btn(), padding: '0 10px' }}>↑</button>
              <button type="button" aria-label="Move down" onClick={() => move(i, 1)} style={{ ...btn(), padding: '0 10px' }}>↓</button>
              <button type="button" aria-label="Remove" onClick={() => save(form.filter((_, j) => j !== i))} style={{ ...btn(), padding: '0 10px' }}>✕</button>
            </div>
            {(q.type === 'one' || q.type === 'chips') && (
              <input aria-label="Choices" value={(q.options || []).join(', ')} onChange={x => edit(i, { options: x.target.value.split(',').map(s => s.trim()) })} onBlur={() => save(form)} style={field} />
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', ...text('caption'), color: colour.inkFaint }}>
              {q.id.startsWith('own') && ['text', 'one', 'chips'].map(t => (
                <button key={t} type="button" aria-pressed={q.type === t} onClick={() => save(form.map((x, j) => (j === i ? { ...x, type: t, options: t === 'text' ? undefined : (x.options?.length ? x.options : ['Option 1', 'Option 2']) } : x)))}
                  style={{ ...btn(q.type === t), minHeight: 30, background: q.type === t ? colour.navy : colour.surface }}>{{ text: 'Typed answer', one: 'Pick one', chips: 'Pick any' }[t]}</button>
              ))}
              <label style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" style={{ fontSize: 16 }} checked={Boolean(q.required)} onChange={x => save(form.map((y, j) => (j === i ? { ...y, required: x.target.checked } : y)))} /> Required</label>
            </div>
          </div>
        ))}
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
    </div>
  )
}

function SendBar({ event, api, smsReady, onDone }) {
  const [via, setVia] = useState(['email'])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const s = summarise(event)
  const unsent = event.guests.filter(g => !g.sent?.email && !g.sent?.sms).length
  async function go(who, reminder) {
    const n = who === 'unsent' ? unsent : who === 'noreply' ? s.none : s.yes
    const what = reminder ? 'a reminder' : 'the invitation'
    if (!window.confirm(`Send ${what} to ${n} ${n === 1 ? 'person' : 'people'} by ${via.join(' and ')}?`)) return
    setBusy(true); setResult(null)
    try {
      const r = await api.send(event.id, { via, who, reminder })
      const count = k => r.results.filter(x => x[k] === 'sent').length
      const failed = r.results.filter(x => x.email === 'failed' || x.sms === 'failed').length
      const skipped = r.results.filter(x => x.skipped).length
      setResult(`${count('email')} emails and ${count('sms')} texts sent${failed ? ` · ${failed} failed` : ''}${skipped ? ` · ${skipped} opted out` : ''}${via.includes('sms') && !r.smsReady ? ' · SMS is not set up yet' : ''}`)
      onDone()
    } catch (err) { setResult(err.message) } finally { setBusy(false) }
  }
  const toggle = v => setVia(x => (x.includes(v) ? x.filter(y => y !== v) : [...x, v]))
  return (
    <div data-send-bar style={{ ...card, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ ...text('bodyStrong') }}>Send by</span>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" style={{ fontSize: 16 }} checked={via.includes('email')} onChange={() => toggle('email')} /> Email</label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" style={{ fontSize: 16 }} checked={via.includes('sms')} onChange={() => toggle('sms')} /> SMS{!smsReady ? ' (not set up yet)' : ''}</label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" data-send-invites disabled={busy || !unsent || !via.length} style={{ ...btn(true), opacity: busy || !unsent ? 0.5 : 1 }} onClick={() => go('unsent', false)}>Send invites to {unsent} not yet invited</button>
        <button type="button" disabled={busy || !s.none || !via.length} style={{ ...btn(), opacity: s.none ? 1 : 0.5 }} onClick={() => go('noreply', true)}>Remind {s.none} who haven't replied</button>
        <button type="button" disabled={busy || !s.yes || !via.length} style={{ ...btn(), opacity: s.yes ? 1 : 0.5 }} onClick={() => go('coming', true)}>Remind {s.yes} coming</button>
      </div>
      {result && <div style={{ ...text('caption'), color: colour.inkMuted }}>{result}</div>}
    </div>
  )
}

function Guests({ event, api, smsReady, onChange, onAdd }) {
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [quick, setQuick] = useState({ name: '', email: '', mobile: '', group: 'Surgeon' })
  const s = summarise(event)
  const shown = event.guests.filter(g => [g.name, g.group, g.email].join(' ').toLowerCase().includes(q.toLowerCase()))
  const setGuest = async (g, change) => onChange((await api.guest(event.id, g.token, change)).event)
  async function addQuick() {
    if (!quick.name) return
    onChange((await api.addGuests(event.id, [], [quick])).event)
    setQuick({ name: '', email: '', mobile: '', group: quick.group })
  }
  const formQs = event.form.slice(0, 3)
  return (
    <div style={{ display: 'grid', gap: space.md }}>
      <div data-counts style={{ display: 'flex', gap: 12, flexWrap: 'wrap', ...text('body') }}>
        <span><b>{s.yes}</b> yes</span><span><b>{s.maybe}</b> maybe</span><span><b>{s.no}</b> no</span>
        <span style={{ color: colour.danger }}><b>{s.none}</b> no reply</span><span><b>{s.waitlist}</b> waitlist</span>
        <span style={{ marginLeft: 'auto', color: colour.inkFaint }}>{s.seats} seats{s.capacity ? ` of ${s.capacity}` : ''}</span>
      </div>
      <SendBar event={event} api={api} smsReady={smsReady} onDone={() => api.get(event.id).then(d => onChange(d.event))} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" data-add-guests style={btn(true)} onClick={onAdd}>+ Add guests from Contacts</button>
        <button type="button" style={btn()} onClick={() => setAdding(a => !a)}>{adding ? 'Close' : '+ Add someone not in Contacts'}</button>
        <input type="search" aria-label="Search guests" placeholder="Search guests" value={q} onChange={x => setQ(x.target.value)} style={{ ...field, width: 220, marginLeft: 'auto' }} />
      </div>
      {adding && (
        <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'end' }}>
          {['name', 'email', 'mobile'].map(k => <label key={k}><span style={lbl}>{k}</span><input value={quick[k]} onChange={x => setQuick(v => ({ ...v, [k]: x.target.value }))} style={field} /></label>)}
          <label><span style={lbl}>Group</span><select value={quick.group} onChange={x => setQuick(v => ({ ...v, group: x.target.value }))} style={field}>{GROUPS.map(g => <option key={g}>{g}</option>)}</select></label>
          <button type="button" style={btn(true)} onClick={addQuick}>Add</button>
        </div>
      )}
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table data-guest-table style={{ width: '100%', borderCollapse: 'collapse', ...text('caption') }}>
          <thead><tr style={{ textAlign: 'left', color: colour.inkFaint }}>
            {['Guest', 'Reply', 'Sent', ...formQs.map(f => f.label), ''].map(h => <th key={h} style={{ padding: '10px 12px', ...text('micro'), textTransform: 'uppercase', borderBottom: `1px solid ${colour.line}` }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {shown.map(g => {
              const st = g.status || 'none'
              return (
                <tr key={g.token} data-guest={g.name} style={{ borderBottom: `1px solid ${colour.lineSoft}` }}>
                  <td style={{ padding: '9px 12px' }}><div style={{ ...text('bodyStrong') }}>{g.name}</div><div style={{ color: colour.inkFaint }}>{g.group}{g.mobile ? ` · ${showMobile(g.mobile)}` : ''}</div></td>
                  <td style={{ padding: '9px 12px' }}>
                    <select aria-label={`${g.name}'s reply`} value={st} onChange={x => setGuest(g, { status: x.target.value })}
                      style={{ border: 'none', borderRadius: radius.pill, padding: '3px 8px', ...text('caption'), fontSize: 16, fontWeight: 700, background: TONE[st][0], color: TONE[st][1] }}>
                      {['none', 'yes', 'maybe', 'no', 'waitlist'].map(o => <option key={o} value={o}>{REPLY_LABEL[o]}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '9px 12px', color: colour.inkMuted }}>{[g.sent?.email && 'Email', g.sent?.sms && 'SMS'].filter(Boolean).join(' + ') || '—'}{g.opened ? ' · opened' : ''}{g.sent?.error ? ' · ⚠' : ''}</td>
                  {formQs.map(f => <td key={f.id} style={{ padding: '9px 12px' }}>{answerText(f, g.answers?.[f.id])}</td>)}
                  <td style={{ padding: '9px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" aria-label={`Copy ${g.name}'s link`} title="Copy their link" onClick={() => navigator.clipboard?.writeText(`${location.origin}/e/${g.token}`)} style={{ ...btn(), minHeight: 30, padding: '0 8px' }}>Link</button>{' '}
                    <button type="button" aria-label={`Remove ${g.name}`} onClick={() => window.confirm(`Take ${g.name} off this event?`) && setGuest(g, { remove: true })} style={{ ...btn(), minHeight: 30, padding: '0 8px' }}>✕</button>
                  </td>
                </tr>
              )
            })}
            {!event.guests.length && <tr><td colSpan={9} style={{ padding: space.lg, color: colour.inkFaint }}>No guests yet — add them from Contacts.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Venue({ event, api, onSave }) {
  const s = summarise(event)
  const [cost, setCost] = useState(event.cost || {})
  const [error, setError] = useState('')
  const share = (cost.ourShare ?? 100) / 100
  const perHead = cost.total && s.seats ? (Number(cost.total) * share / s.seats).toFixed(2) : ''
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: space.lg, alignItems: 'start' }}>
      <div data-venue-sheet style={{ ...card, display: 'grid', gap: 8 }}>
        <span style={lbl}>For the venue</span>
        <div style={{ ...text('title') }}>{s.seats} guests</div>
        {s.tallies.map(t => (
          <div key={t.id} style={{ ...text('body') }}><b>{t.label}:</b> {Object.entries(t.counts).filter(([, n]) => n).map(([o, n]) => `${o} ${n}`).join(' · ') || '—'}</div>
        ))}
        {s.notes.length > 0 && <div style={{ ...text('body') }}><b>Notes:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{s.notes.map((n, i) => <li key={i}>{n.who} — {n.label}: {n.text}</li>)}</ul></div>}
        <button type="button" style={btn(true)} onClick={() => api.download(event.id, 'venue')}>Download the venue sheet</button>
      </div>
      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <span style={lbl}>Cost and hospitality record (MTAA)</span>
        <label><span style={lbl}>Total cost (AUD, incl. GST)</span><input type="number" min="0" value={cost.total || ''} onChange={x => setCost(c => ({ ...c, total: x.target.value }))} style={field} /></label>
        <label><span style={lbl}>Shared with (co-host)</span><input value={cost.sharedWith || ''} onChange={x => setCost(c => ({ ...c, sharedWith: x.target.value }))} placeholder="e.g. Signus" style={field} /></label>
        <label><span style={lbl}>TechnoMed's share (%)</span><input type="number" min="0" max="100" value={cost.ourShare ?? 100} onChange={x => setCost(c => ({ ...c, ourShare: x.target.value }))} style={field} /></label>
        <label><span style={lbl}>Note</span><input value={cost.note || ''} onChange={x => setCost(c => ({ ...c, note: x.target.value }))} style={field} /></label>
        <div style={{ ...text('body') }}>{perHead ? `TechnoMed cost per head: $${perHead}` : 'Enter the cost to work out the cost per head.'} · Healthcare professionals coming: {s.hcp}</div>
        {error && <Banner tone="danger">{error}</Banner>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={btn(true)} onClick={async () => { setError(''); try { await onSave({ ...event, cost }) } catch (err) { setError(err.message) } }}>Save cost</button>
          <button type="button" style={btn()} onClick={() => api.download(event.id, 'record')}>Download the hospitality record</button>
        </div>
      </div>
    </div>
  )
}

function CheckIn({ event, api, onChange }) {
  const [q, setQ] = useState('')
  const coming = event.guests.filter(g => g.status === 'yes' || g.checkedIn)
  const here = coming.filter(g => g.checkedIn).length
  const total = coming.reduce((n, g) => n + seatsFor(g), 0)
  const shown = coming.filter(g => g.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div style={{ display: 'grid', gap: space.md, maxWidth: 560 }}>
      <div style={{ ...text('title') }}>{here} of {coming.length} here <span style={{ ...text('caption'), color: colour.inkFaint }}>({total} seats incl. partners)</span></div>
      <input type="search" aria-label="Find a guest" placeholder="Find a guest" value={q} onChange={x => setQ(x.target.value)} style={field} />
      {shown.map(g => (
        <div key={g.token} data-checkin={g.name} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...text('bodyStrong') }}>{g.name}</div>
            <div style={{ ...text('caption'), color: colour.inkFaint }}>{[g.group, ...event.form.map(f => answerText(f, g.answers?.[f.id])).filter(Boolean)].join(' · ')}</div>
          </div>
          <button type="button" aria-pressed={Boolean(g.checkedIn)} onClick={async () => onChange((await api.guest(event.id, g.token, { checkedIn: !g.checkedIn })).event)}
            style={{ ...btn(Boolean(g.checkedIn)), minWidth: 96 }}>{g.checkedIn ? '✓ Here' : 'Check in'}</button>
        </div>
      ))}
    </div>
  )
}

export default function EventPage({ user, id, onBack, gallery = null }) {
  const api = useMemo(() => eventsApi(user.token), [user.token])
  const [event, setEvent] = useState(null)
  const [smsReady, setSmsReady] = useState(false)
  const [tab, setTab] = useState('guests')
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)
  useBackLayer(picking, () => setPicking(false))
  useEffect(() => { api.get(id).then(d => { setEvent(d.event); setSmsReady(d.smsReady) }).catch(err => setError(err.message)) }, [api, id])
  const save = async next => setEvent((await api.save(next)).event)

  if (picking && event) {
    return <Contacts user={user} onBack={() => setPicking(false)}
      pick={{ already: event.guests.map(g => g.contactId).filter(Boolean), onAdd: async ids => { setEvent((await api.addGuests(event.id, ids)).event); setPicking(false) } }} />
  }
  const sum = event ? summarise(event) : null
  const kind = event ? EVENT_KINDS.find(k => k.id === event.kind) : null
  const glass = { background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.28)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', color: 'white' }
  const stat = (n, label, tone) => (
    <div style={{ ...glass, borderRadius: radius.control, padding: '6px 12px', minWidth: 64 }}>
      <div style={{ fontSize: 22, lineHeight: 1.1, fontWeight: 800, color: tone || 'white' }}>{n}</div>
      <div style={{ ...text('micro'), textTransform: 'uppercase', opacity: 0.85 }}>{label}</div>
    </div>
  )
  // The event's own photo hero (Brent, 26 Nov 2026: "less like a form to fill
  // out and more like an interactive app"), the replies at a glance, and the
  // sections as a row of pills.
  return (
    <div data-event-page className="tm-page" style={{ background: colour.canvas, minHeight: '100%' }}>
      <EventStyles />
      <div data-event-hero style={{ position: 'relative', color: 'white', background: WASH }}>
        <Photo token={user.token} id={event ? photoForKind(gallery, event.kind, seedOf(event.id)) : ''} size="large" style={{ position: 'absolute', inset: 0 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(2,27,49,0.25) 0%, rgba(2,27,49,0.55) 50%, rgba(2,27,49,0.92) 100%)' }} />
        <div style={{ position: 'relative', padding: `calc(env(safe-area-inset-top) + ${space.md}px) ${space.lg}px ${space.md}px`, maxWidth: 1100, margin: '0 auto' }}>
          <button type="button" onClick={onBack} aria-label="Back" style={{ ...glass, width: 40, height: 40, borderRadius: radius.pill, cursor: 'pointer', ...text('title'), display: 'grid', placeItems: 'center' }}>‹</button>
          <div style={{ marginTop: 56, animation: 'tmEvRise 450ms ease both' }}>
            <div style={{ ...text('micro'), textTransform: 'uppercase', opacity: 0.85 }}>{kind?.label || 'Event'}</div>
            <div style={{ fontSize: 30, lineHeight: 1.12, fontWeight: 800, letterSpacing: '-0.6px', margin: '4px 0 6px' }}>{event?.title || 'Loading…'}</div>
            <div style={{ ...text('body'), opacity: 0.9 }}>{event ? [whenText(event.start) || 'No date yet', event.venue].filter(Boolean).join(' · ') : ''}</div>
            {sum && (
              <div data-event-stats style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: space.md }}>
                {stat(sum.yes, 'Coming')}
                {stat(sum.maybe, 'Maybe')}
                {stat(sum.none, 'No reply')}
                {stat(sum.invited, 'Invited')}
                {sum.capacity > 0 && stat(sum.left, 'Seats left')}
              </div>
            )}
          </div>
          <nav aria-label="Event sections" data-ev-scroll style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: space.lg, scrollbarWidth: 'none' }}>
            {TABS.map(([k, l]) => (
              <button key={k} type="button" data-event-tab={k} aria-pressed={tab === k} onClick={() => setTab(k)}
                style={{ ...(tab === k ? { background: colour.surface, color: colour.ink, border: '1px solid transparent' } : glass), padding: '8px 14px', borderRadius: radius.pill, cursor: 'pointer', whiteSpace: 'nowrap', ...text('bodyStrong'), transition: 'background 200ms ease' }}>{l}</button>
            ))}
          </nav>
        </div>
      </div>
      <div style={{ padding: `${space.lg}px ${space.lg}px ${space.xxxl}px`, maxWidth: 1100, margin: '0 auto' }}>
        {error && <Banner tone="danger">{error}</Banner>}
        <div key={tab} style={{ animation: 'tmEvRise 300ms ease both' }}>
          {event && tab === 'guests' && <Guests event={event} api={api} smsReady={smsReady} onChange={setEvent} onAdd={() => setPicking(true)} />}
          {event && tab === 'details' && <Details event={event} api={api} onSave={save} onUploaded={setEvent} />}
          {event && tab === 'form' && <FormBuilder event={event} onSave={save} />}
          {event && tab === 'venue' && <Venue event={event} api={api} onSave={save} />}
          {event && tab === 'checkin' && <CheckIn event={event} api={api} onChange={setEvent} />}
        </div>
      </div>
    </div>
  )
}
