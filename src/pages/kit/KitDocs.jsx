import React, { useState, useEffect, useCallback, useRef } from 'react'
import { upload } from '@vercel/blob/client'
import { colour, text, space, radius, border } from '../../design/tokens.js'
import { shareFile, typeOfName, shareReady } from '../../kit/share.js'
import FromDropbox from './FromDropbox.jsx'
import { needsAgreement } from '../../kit/agreements.js'
import DocViewer, { viewKind } from '../../kit/DocViewer.jsx'

// ─── A kit's documents (Brent, 11 Nov 2026) ──────────────────────────────────
// Consignment agreements and anything else that belongs to a kit, added from
// a file in one tap (or dropped onto the panel on a desktop), opened, shared
// through the phone's share sheet, or taken off. Filed in Dropbox under
// /Kit Room/{kit}/ — see api/_kitDocs.js. Anyone signed in can add; every
// change is in the kit room's history with who made it.

const KIND_LABEL = { consignment: 'Consignment agreement', traylist: 'Tray list', other: 'Document' }
const SMALL = 2.8 * 1024 * 1024
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*'

const sizeText = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const when = iso => (iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Hobart', day: 'numeric', month: 'short', year: 'numeric' }) : '')

function asBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('Could not read that file'))
    r.readAsDataURL(file)
  })
}

export default function KitDocs({ kit, user, post, onChanged }) {
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState('')
  const [over, setOver] = useState(false)
  const [fromDropbox, setFromDropbox] = useState(false)
  const [viewing, setViewing] = useState(null)
  const pick = useRef(null)
  const kindFor = useRef('consignment')
  const auth = { Authorization: `Bearer ${user?.token || ''}` }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/guides?kits=docs&id=${encodeURIComponent(kit.id)}`, { headers: auth })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the documents')
      setDocs(body.docs || [])
    } catch (err) { setError(err.message); setDocs([]) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit.id, user?.token])

  useEffect(() => { load() }, [load])

  async function addFiles(files, kind) {
    const list = [...(files || [])]
    if (!list.length) return
    setError(''); setStatus('')
    for (const [i, file] of list.entries()) {
      setBusy(`Adding ${list.length > 1 ? `${i + 1} of ${list.length}: ` : ''}${file.name}…`)
      try {
        let payload
        if (file.size <= SMALL) payload = { data: await asBase64(file) }
        else {
          const up = await upload(`kitdocs/${Date.now()}-${file.name.replace(/[^\w.\- ]+/g, '_')}`, file, {
            access: 'public', contentType: file.type || typeOfName(file.name),
            handleUploadUrl: '/api/meetings/agent?action=blob-upload',
            clientPayload: JSON.stringify({ token: user?.token || null })
          })
          payload = { url: up.url }
        }
        await post('doc-keep', { kitId: kit.id, kind, filename: file.name, ...payload })
      } catch (err) {
        setError(`${file.name}: ${err.message}`)
      }
    }
    setBusy('')
    setStatus(list.length === 1 ? 'Added.' : `${list.length} documents added.`)
    await load()
    onChanged?.()
  }

  async function linkFor(doc) {
    const res = await fetch(`/api/guides?kits=doc-link&id=${encodeURIComponent(kit.id)}&doc=${encodeURIComponent(doc.id)}`, { headers: auth })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || 'Could not open it')
    return body
  }

  // Opened in the portal's own viewer (Brent, 11 Nov 2026: "you should be
  // able to view it in the portal") — PDFs page by page, Word as text.
  async function open(doc) {
    setError(''); setBusy(`Opening ${doc.name}…`)
    try {
      const { url, name, path, rev } = await linkFor(doc)
      setViewing({ doc, url, name: name || doc.name, path: path || doc.path, rev })
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  async function share(doc) {
    setError(''); setStatus(''); setBusy(`Getting ${doc.name} ready…`)
    try {
      const { url, name } = await linkFor(doc)
      const how = await shareFile({ url, name, title: `${kit.name} — ${KIND_LABEL[doc.kind] || 'Document'}` })
      if (how === 'downloaded') setStatus('Downloaded — attach it to an email or message.')
      if (how === 'needs-tap') setStatus('ready')
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  async function remove(doc) {
    if (!window.confirm(`Take ${doc.name} off ${kit.name}? It stays in Dropbox.`)) return
    setError('')
    try { await post('doc-remove', { kitId: kit.id, docId: doc.id }); await load(); onChanged?.() } catch (err) { setError(err.message) }
  }

  function choose(kind) { kindFor.current = kind; pick.current?.click() }

  const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.lg}px 0 ${space.sm}px` }
  const small = on => ({ ...text('caption'), fontWeight: 600, minHeight: 34, padding: '0 12px', borderRadius: radius.pill, cursor: 'pointer',
    border: on ? 'none' : border.hairline, background: on ? colour.navy : colour.surface, color: on ? 'white' : colour.ink })
  const loan = !needsAgreement(kit)
  const consignment = (docs || []).filter(d => d.kind === 'consignment')
  const others = (docs || []).filter(d => d.kind !== 'consignment')

  const row = doc => (
    <div key={doc.id} data-kit-doc={doc.id} style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px 0`, borderBottom: border.hairlineSoft }}>
      <span aria-hidden="true" style={{
        ...text('micro'), width: 36, height: 36, flexShrink: 0, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: doc.kind === 'consignment' ? colour.accentSoft : colour.lineSoft, color: colour.navy
      }}>{(doc.name.split('.').pop() || 'DOC').slice(0, 4).toUpperCase()}</span>
      <button onClick={() => open(doc)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        <div style={{ ...text('bodyStrong'), color: colour.ink, overflowWrap: 'anywhere' }}>{doc.name}</div>
        <div style={{ ...text('caption'), color: colour.inkFaint }}>
          {[doc.linked ? 'linked from Dropbox' : sizeText(doc.size || 0), doc.by && `added by ${doc.by}`, when(doc.at)].filter(Boolean).join(' · ')}
        </div>
      </button>
      <button onClick={() => share(doc)} aria-label={`Share ${doc.name}`} style={small(true)}>Share</button>
      <button onClick={() => remove(doc)} aria-label={`Take ${doc.name} off`} style={{ ...small(false), color: colour.danger, padding: '0 10px' }}>✕</button>
    </div>
  )

  const viewer = viewing && (
    <DocViewer name={viewing.name} url={viewing.url} path={viewing.path} rev={viewing.rev} onClose={() => setViewing(null)}
      onShare={() => { const d = viewing.doc; setViewing(null); share(d) }} />
  )

  return (
    <div data-kit-docs
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer?.files, loan ? 'other' : 'consignment') }}
      style={{ outline: over ? `2px dashed ${colour.accent}` : 'none', borderRadius: radius.control }}>
      <input ref={pick} type="file" multiple accept={ACCEPT} hidden style={{ fontSize: 16 }}
        onChange={e => { const f = e.target.files; e.target.value = ''; addFiles(f, kindFor.current) }} />

      {loan ? (
        <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.md }}>
          A TM loan kit — no consignment agreement needed. Its tray list is below.
        </div>
      ) : <>
        <div style={label}>Consignment agreement{consignment.length === 1 ? '' : 's'} · {consignment.length}</div>
        {docs === null && <div style={{ ...text('caption'), color: colour.inkFaint }}>Loading…</div>}
        {docs && consignment.length === 0 && (
          <div style={{ ...text('caption'), color: colour.inkFaint }}>None on file yet.</div>
        )}
        {consignment.map(row)}
      </>}
      {/* A loan kit that was given an agreement before keeps it in view. */}
      {loan && consignment.map(row)}

      <div style={label}>{loan ? 'Documents' : 'Other documents'} · {others.length}</div>
      {docs && others.length === 0 && <div style={{ ...text('caption'), color: colour.inkFaint }}>None yet.</div>}
      {others.map(row)}

      <div style={{ display: 'flex', gap: space.xs, flexWrap: 'wrap', marginTop: space.sm }}>
        {!loan && <button onClick={() => choose('consignment')} disabled={Boolean(busy)} style={small(false)}>+ Consignment agreement</button>}
        <button onClick={() => choose('other')} disabled={Boolean(busy)} style={small(false)}>+ Other document</button>
        <button onClick={() => setFromDropbox(v => !v)} data-open-from-dropbox style={small(fromDropbox)}>+ From Dropbox</button>
      </div>
      <div style={{ ...text('caption'), color: colour.inkFainter, marginTop: 4 }}>
        PDF, Word, Excel or a photo. On a computer, drop files here.
      </div>
      {fromDropbox && (
        <FromDropbox kit={kit} kind={loan ? 'traylist' : 'consignment'} user={user} post={post} onClose={() => setFromDropbox(false)}
          onDone={async file => { setStatus(`Attached ${file.name}.`); await load(); onChanged?.() }} />
      )}
      {busy && <div role="status" style={{ ...text('caption'), color: colour.inkMuted, marginTop: space.xs }}>{busy}</div>}
      {status === 'ready' && !busy && (
        <button type="button" onClick={async () => { setStatus(''); try { await shareReady() } catch (err) { setError(err.message) } }}
          style={{ ...text('bodyStrong'), width: '100%', padding: space.sm, marginTop: space.xs, borderRadius: radius.control,
            border: 'none', background: colour.accent, color: 'white', cursor: 'pointer' }}>
          Ready — tap to share
        </button>
      )}
      {status && status !== 'ready' && !busy && <div role="status" style={{ ...text('caption'), color: colour.accentDeep, marginTop: space.xs }}>{status}</div>}
      {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.xs }}>{error}</div>}
      {viewer}
    </div>
  )
}
