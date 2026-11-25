import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useBackLayer } from '../../backButton.js'
import { Page, Header, Body, Banner, Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { GROUPS, parseVcf, matchPhoneContacts, parseContactList, showMobile } from '../../events/model.js'
import { eventsApi } from './eventsApi.js'

// ─── Events → Contacts (Brent, 25 Nov 2026) ─────────────────────────────────
// Everyone who might be invited, grouped Surgeon / Registrar / Theatre / Rep.
// Built from email first; a phone's .vcf only fills in mobiles for people
// already here ("don't add all the contacts from my phone"). In `pick` mode it
// is the "Add guests" chooser for an event.

const btn = (primary = false) => ({
  minHeight: 40, padding: '0 14px', borderRadius: radius.control, cursor: 'pointer', ...text('bodyStrong'),
  border: primary ? 'none' : `1px solid ${colour.line}`, background: primary ? colour.accent : colour.surface,
  color: primary ? 'white' : colour.ink, whiteSpace: 'nowrap'
})
const field = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: radius.control, border: `1px solid ${colour.line}`, ...text('field'), background: colour.surface, color: colour.ink }
const lbl = { ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', display: 'block', marginBottom: 4 }

function ContactSheet({ contact, api, onClose, onSaved }) {
  useBackLayer(true, onClose)
  const [c, setC] = useState({ group: 'Surgeon', tags: [], ...contact })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setC(x => ({ ...x, [k]: v }))
  async function save(extra = {}) {
    setBusy(true); setError('')
    try { await api.saveContact({ ...c, ...extra, tags: typeof c.tags === 'string' ? c.tags.split(',') : c.tags }); onSaved() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function remove() {
    if (!window.confirm(`Take ${c.name} off the contacts?`)) return
    setBusy(true)
    try { await api.removeContact(c.id); onSaved() } catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <Overlay>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Contact" data-contact-sheet className="tm-sheet"
          style={{ background: colour.surface, width: '100%', maxWidth: 520, maxHeight: '90%', overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box', borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`, padding: space.lg, display: 'grid', gap: space.md }}>
          <div style={{ ...text('title') }}>{c.id ? c.name : 'Add a person'}</div>
          {[['name', 'Name'], ['email', 'Email'], ['mobile', 'Mobile'], ['hospital', 'Hospital or company'], ['title', 'Role or title']].map(([k, l]) => (
            <label key={k}><span style={lbl}>{l}</span><input value={k === 'mobile' ? showMobile(c[k]) : (c[k] || '')} onChange={e => set(k, e.target.value)} style={field} /></label>
          ))}
          <div>
            <span style={lbl}>Group</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {GROUPS.map(g => <button key={g} type="button" aria-pressed={c.group === g} onClick={() => set('group', g)} style={{ ...btn(c.group === g), minHeight: 34, background: c.group === g ? colour.navy : colour.surface }}>{g}</button>)}
            </div>
          </div>
          <label><span style={lbl}>Tags (comma between)</span><input value={Array.isArray(c.tags) ? c.tags.join(', ') : c.tags} onChange={e => set('tags', e.target.value)} placeholder="Spine, Calvary, cadaver lab" style={field} /></label>
          {c.optedOut && <Banner tone="warning">Opted out of event invites ({c.optedOut.how}). They won't be sent anything.</Banner>}
          {error && <div role="alert" style={{ color: colour.danger, ...text('body') }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" data-save-contact disabled={busy} onClick={() => save()} style={{ ...btn(true), flex: 1 }}>Save</button>
            {c.optedOut && <button type="button" onClick={() => save({ optedOut: null })} style={btn()}>They want invites again</button>}
            {c.id && <button type="button" onClick={remove} style={{ ...btn(), color: colour.danger }}>Remove</button>}
          </div>
        </div>
      </div>
    </Overlay>
  )
}

export default function Contacts({ user, onBack, pick = null }) {
  const api = useMemo(() => eventsApi(user.token), [user.token])
  const [contacts, setContacts] = useState(null)
  const [group, setGroup] = useState('All')
  const [q, setQ] = useState('')
  const [chosen, setChosen] = useState(new Set())
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [phoneOnly, setPhoneOnly] = useState(null)
  const [ticked, setTicked] = useState(new Set())
  const [adding, setAdding] = useState(false)
  const vcfInput = useRef(null)
  const listInput = useRef(null)

  const load = () => api.contacts().then(d => setContacts(d.contacts)).catch(err => setError(err.message))
  useEffect(() => { load() }, [api])

  const counts = useMemo(() => Object.fromEntries(GROUPS.map(g => [g, (contacts || []).filter(c => c.group === g).length])), [contacts])
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (contacts || []).filter(c => (group === 'All' || c.group === group)
      && words.every(w => [c.name, c.hospital, c.title, c.email, ...(c.tags || [])].join(' ').toLowerCase().includes(w)))
  }, [contacts, group, q])

  async function importPhone(file) {
    setNotice(''); setError('')
    try {
      const cards = parseVcf(await file.text())
      const { updates, work } = matchPhoneContacts(contacts || [], cards)
      const { filled } = await api.phoneMobiles(updates)
      setNotice(`Phone contacts read: ${filled} mobile${filled === 1 ? '' : 's'} added to people already here.${work.length ? ` ${work.length} work contacts are only in your phone — tick who to add below.` : ''} Everyone else in your phone was left out.`)
      setPhoneOnly(work)
      setTicked(new Set(work.filter(w => w.suggested).map(w => w.key)))
      load()
    } catch (err) { setError(err.message) }
  }
  async function importList(file) {
    setNotice(''); setError('')
    try {
      const list = parseContactList(await file.text())
      if (!list.length) throw new Error("Nothing to import — the file needs a header row with at least 'name' and 'email' or 'mobile'.")
      const r = await api.importContacts(list, file.name.endsWith('.json') ? 'email' : 'list')
      setNotice(`${r.added} added, ${r.merged} matched people already here. ${r.total} contacts now.`)
      load()
    } catch (err) { setError(err.message) }
  }

  async function addPhoneOnly() {
    setAdding(true); setError('')
    try {
      const list = phoneOnly.filter(w => ticked.has(w.key))
        .map(({ name, mobile, email, group, hospital, title }) => ({ name, mobile, email, group, hospital, title, tags: ['From phone'] }))
      const r = await api.importContacts(list, 'phone')
      setNotice(`${r.added} added from your phone. ${r.total} contacts now.`)
      setPhoneOnly(null)
      load()
    } catch (err) { setError(err.message) } finally { setAdding(false) }
  }
  const tick = key => setTicked(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  const toggle = id => setChosen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const taken = new Set(pick?.already || [])

  return (
    <Page>
      <Header eyebrow="Events" title={pick ? 'Add guests' : 'Contacts'} onBack={onBack} compact
        subtitle={contacts ? `${contacts.length} people · ${contacts.filter(c => c.optedOut).length} opted out` : 'Loading…'} />
      <Body>
        {!pick && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: space.md }}>
            <button type="button" style={btn(true)} onClick={() => setEditing({})}>+ Add a person</button>
            <button type="button" style={btn()} onClick={() => listInput.current?.click()}>Import a list (.csv / .json)</button>
            <button type="button" style={btn()} onClick={() => vcfInput.current?.click()}>Add mobiles from phone (.vcf)</button>
            <input ref={listInput} type="file" accept=".csv,.json,text/csv,application/json" hidden style={{ fontSize: 16 }} onChange={e => e.target.files[0] && importList(e.target.files[0])} />
            <input ref={vcfInput} type="file" accept=".vcf,text/vcard" hidden style={{ fontSize: 16 }} onChange={e => e.target.files[0] && importPhone(e.target.files[0])} />
          </div>
        )}
        {notice && <Banner tone="success">{notice}</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        {phoneOnly?.length > 0 && !pick && (
          <div data-phone-only style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md, marginBottom: space.md }}>
            <div style={{ ...text('heading'), color: colour.ink }}>Only in your phone</div>
            <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
              Work contacts with a mobile that aren&rsquo;t in the list. Clinical staff are ticked; reps and anything unclear are not. Nobody is added until you tap Add.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: space.sm }}>
              <button type="button" style={btn()} onClick={() => setTicked(new Set(phoneOnly.map(w => w.key)))}>Tick all</button>
              <button type="button" style={btn()} onClick={() => setTicked(new Set())}>Untick all</button>
              <button type="button" style={btn()} onClick={() => setPhoneOnly(null)}>Not now</button>
            </div>
            {GROUPS.filter(g => phoneOnly.some(w => w.group === g)).map(g => (
              <div key={g} style={{ marginBottom: space.sm }}>
                <div style={{ ...text('micro'), color: colour.inkFaint, textTransform: 'uppercase', margin: `${space.sm}px 0 4px` }}>{g} · {phoneOnly.filter(w => w.group === g).length}</div>
                {phoneOnly.filter(w => w.group === g).map(w => (
                  <label key={w.key} data-phone-only-row style={{ display: 'flex', gap: space.sm, alignItems: 'center', padding: '6px 0', borderTop: `1px solid ${colour.line}`, cursor: 'pointer' }}>
                    <input type="checkbox" checked={ticked.has(w.key)} onChange={() => tick(w.key)} style={{ width: 20, height: 20, fontSize: 16, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', ...text('bodyStrong'), color: colour.ink }}>{w.name}</span>
                      <span style={{ display: 'block', ...text('caption'), color: colour.inkFaint, overflowWrap: 'anywhere' }}>{[w.title, showMobile(w.mobile)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
            <button type="button" data-phone-only-add disabled={adding || !ticked.size} style={{ ...btn(true), width: '100%', marginTop: space.sm, opacity: adding || !ticked.size ? 0.6 : 1 }} onClick={addPhoneOnly}>
              {adding ? 'Adding…' : `Add ${ticked.size} to contacts`}
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: space.sm }}>
          {['All', ...GROUPS].map(g => (
            <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}
              style={{ ...btn(), minHeight: 34, borderRadius: radius.pill, background: group === g ? colour.navy : colour.surface, color: group === g ? 'white' : colour.ink, border: group === g ? 'none' : `1px solid ${colour.line}` }}>
              {g}{g !== 'All' && contacts ? ` ${counts[g]}` : ''}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Search contacts" placeholder="Search name, hospital, tag" value={q} onChange={e => setQ(e.target.value)} style={{ ...field, marginBottom: space.sm }} />

        {pick && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: space.sm, flexWrap: 'wrap' }}>
            <button type="button" style={btn()} onClick={() => setChosen(new Set(shown.filter(c => !c.optedOut && !taken.has(c.id)).map(c => c.id)))}>Choose all {shown.length} shown</button>
            <span style={{ ...text('caption'), color: colour.inkFaint }}>{chosen.size} chosen</span>
            <button type="button" data-add-chosen disabled={!chosen.size} style={{ ...btn(true), marginLeft: 'auto', opacity: chosen.size ? 1 : 0.5 }} onClick={() => pick.onAdd([...chosen])}>Add {chosen.size || ''} to the event</button>
          </div>
        )}

        <div data-contact-list style={{ background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, overflow: 'hidden' }}>
          {contacts && !shown.length && <div style={{ padding: space.lg, ...text('body'), color: colour.inkFaint }}>{contacts.length ? 'Nobody matches.' : 'No contacts yet — import the list from email first.'}</div>}
          {shown.slice(0, 400).map(c => {
            const off = Boolean(c.optedOut) || taken.has(c.id)
            return (
              <div key={c.id} data-contact={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: `1px solid ${colour.lineSoft}`, opacity: off ? 0.5 : 1 }}>
                {pick && <input type="checkbox" style={{ fontSize: 16 }} aria-label={`Choose ${c.name}`} disabled={off} checked={chosen.has(c.id)} onChange={() => toggle(c.id)} style={{ width: 20, height: 20, fontSize: 16 }} />}
                <button type="button" onClick={() => (pick ? !off && toggle(c.id) : setEditing(c))}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: colour.ink }}>
                  <div style={{ ...text('bodyStrong') }}>{c.name}{c.optedOut ? ' · opted out' : ''}{taken.has(c.id) ? ' · already invited' : ''}</div>
                  <div style={{ ...text('caption'), color: colour.inkFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[c.group, c.hospital, c.email, c.mobile && showMobile(c.mobile)].filter(Boolean).join(' · ')}
                  </div>
                </button>
              </div>
            )
          })}
        </div>
        {shown.length > 400 && <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 6 }}>Showing 400 of {shown.length} — search to narrow it.</div>}
      </Body>
      {editing && <ContactSheet contact={editing} api={api} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </Page>
  )
}
