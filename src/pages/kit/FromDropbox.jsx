import React, { useState, useEffect } from 'react'
import { colour, text, space, radius, border } from '../../design/tokens.js'

// ─── Add from Dropbox (Brent, 11 Nov 2026: "Build option 2") ─────────────────
// A file already in Dropbox attached to the kit by its path — no copy, so the
// kit always opens the current version. Opens on the files that look like
// this kit's (its system and hospital in the name or folder), with a search
// for anything else. Only the consignment agreement, tray list and kit room
// folders are ever offered — see api/_kitDocs.js.

const where = path => path.split('/').slice(1, -1).slice(-2).join(' › ')

export default function FromDropbox({ kit, kind = 'consignment', user, post, onDone, onClose }) {
  const [suggested, setSuggested] = useState(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const auth = { Authorization: `Bearer ${user?.token || ''}` }

  useEffect(() => {
    let live = true
    fetch(`/api/guides?kits=dbx-suggest&id=${encodeURIComponent(kit.id)}&kind=${kind}`, { headers: auth })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!live) return; if (!ok) throw new Error(b.error || 'Dropbox could not be read'); setSuggested(b.suggested || []) })
      .catch(err => { if (live) { setError(err.message); setSuggested([]) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit.id])

  async function search(e) {
    e?.preventDefault()
    if (!q.trim()) { setFound(null); return }
    setBusy('search')
    try {
      const r = await fetch(`/api/guides?kits=dbx-search&q=${encodeURIComponent(q.trim())}`, { headers: auth })
      const b = await r.json()
      if (!r.ok) throw new Error(b.error || 'Could not search Dropbox')
      setFound(b.files || [])
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  async function attach(file) {
    setBusy(file.path); setError('')
    try {
      await post('doc-dbx', { kitId: kit.id, path: file.path, kind: file.kind })
      onDone?.(file)
    } catch (err) { setError(err.message) }
    setBusy('')
  }

  const row = file => (
    <div key={file.path} data-dbx-file style={{ display: 'flex', alignItems: 'center', gap: space.sm, padding: `${space.sm}px 0`, borderBottom: border.hairlineSoft }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...text('bodyStrong'), color: colour.ink, overflowWrap: 'anywhere' }}>{file.name}</div>
        <div style={{ ...text('caption'), color: colour.inkFaint, overflowWrap: 'anywhere' }}>{where(file.path)}</div>
      </div>
      <button onClick={() => attach(file)} disabled={Boolean(busy)} style={{
        ...text('caption'), fontWeight: 700, minHeight: 34, padding: '0 12px', borderRadius: radius.pill, border: 'none',
        background: colour.accent, color: 'white', cursor: busy ? 'default' : 'pointer', flexShrink: 0
      }}>{busy === file.path ? 'Attaching…' : 'Attach'}</button>
    </div>
  )

  return (
    <div data-from-dropbox style={{ border: border.hairline, borderRadius: radius.control, padding: space.sm, marginTop: space.sm, background: colour.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: space.xs }}>
        <span style={{ ...text('bodyStrong'), color: colour.ink, flex: 1 }}>Add from Dropbox</span>
        <button onClick={onClose} style={{ ...text('caption'), background: 'none', border: 'none', color: colour.inkFaint, cursor: 'pointer' }}>Close</button>
      </div>
      <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.xs }}>
        Linked, not copied — the kit always opens the file as it is in Dropbox.
      </div>
      {suggested === null && <div style={{ ...text('caption'), color: colour.inkFaint }}>Looking for {kit.name}'s {kind === 'traylist' ? 'tray lists' : 'agreements'}…</div>}
      {suggested && suggested.length > 0 && <>
        <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.xs}px 0` }}>Looks like this kit's</div>
        {suggested.map(row)}
      </>}
      {suggested && suggested.length === 0 && !error && (
        <div style={{ ...text('caption'), color: colour.inkFaint }}>Nothing in Dropbox's {kind === 'traylist' ? 'Tray Lists' : 'Consignment Agreements'} folder names this kit — search below.</div>
      )}
      <form onSubmit={search} style={{ display: 'flex', gap: space.xs, marginTop: space.sm }}>
        <input value={q} onChange={e => setQ(e.target.value)} aria-label="Search Dropbox" placeholder="Search — e.g. Diplomat CLV"
          style={{ ...text('field'), flex: 1, minWidth: 0, padding: `${space.xs}px ${space.sm}px`, border: border.hairline, borderRadius: radius.control, background: colour.surface, color: colour.ink }} />
        <button type="submit" disabled={busy === 'search'} style={{
          ...text('caption'), fontWeight: 700, minHeight: 40, padding: `0 ${space.md}px`, border: 'none', borderRadius: radius.control,
          background: colour.navy, color: 'white', cursor: 'pointer'
        }}>{busy === 'search' ? 'Finding…' : 'Find'}</button>
      </form>
      {found && found.length === 0 && <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.xs }}>Nothing matches.</div>}
      {found && found.map(row)}
      {error && <div role="alert" style={{ ...text('caption'), color: colour.danger, marginTop: space.xs }}>{error}</div>}
    </div>
  )
}
