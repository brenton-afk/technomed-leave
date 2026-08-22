import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Page, Header, Body, Card, Banner, EmptyState, Skeleton } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { IconFolder, IconFile, IconChevron } from '../design/icons.jsx'

// ─── Dropbox browser ──────────────────────────────────────────────────────────
// One component, two jobs: the shared resources folder, and the usage files
// that were filed after a scan. They are the same problem — a Dropbox tree the
// phone needs to read — so they get the same component rather than two.

function formatSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function FileBrowser({ user, root = 'usage', title, eyebrow, onBack, startPath }) {
  const [path, setPath] = useState(startPath || null)
  const [trail, setTrail] = useState([])
  const [entries, setEntries] = useState([])
  const [state, setState] = useState('loading') // loading | ready | empty | error | unconfigured
  const [error, setError] = useState('')
  const [opening, setOpening] = useState('')

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])

  const load = useCallback(async (target) => {
    setState('loading'); setError('')
    try {
      const query = new URLSearchParams({ action: 'files', root })
      if (target) query.set('path', target)
      const res = await fetch(`/api/usage/agent?${query}`, { headers: authHeaders })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      if (data.configured === false) { setState('unconfigured'); return }
      setPath(data.path)
      setEntries(data.entries || [])
      setState((data.entries || []).length ? 'ready' : 'empty')
    } catch (err) {
      setError(err.message)
      setState('error')
    }
  }, [authHeaders, root])

  useEffect(() => { load(startPath) }, [load, startPath])

  function openFolder(entry) {
    setTrail(t => [...t, { path, name: entry.name }])
    load(entry.path)
  }

  function goUp() {
    const previous = trail[trail.length - 1]
    if (!previous) { onBack?.(); return }
    setTrail(t => t.slice(0, -1))
    load(previous.path)
  }

  // A fresh temporary link per tap. Dropbox expires them after about four
  // hours, so caching one would leave a public URL to patient data lying about.
  async function openFile(entry) {
    setOpening(entry.path); setError('')
    try {
      const res = await fetch(
        `/api/usage/agent?action=open&path=${encodeURIComponent(entry.path)}`,
        { headers: authHeaders }
      )
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      window.open(data.url, '_blank', 'noopener')
    } catch (err) {
      setError(`Could not open ${entry.name}: ${err.message}`)
    }
    setOpening('')
  }

  const here = trail.length ? trail[trail.length - 1].name : null

  return (
    <Page>
      <Header
        eyebrow={eyebrow}
        title={title}
        subtitle={trail.length ? trail.map(t => t.name).concat(here ? [] : []).join(' / ') : undefined}
        onBack={goUp}
      />
      <Body>
        {error && <Banner tone="danger">{error}</Banner>}

        {state === 'unconfigured' && (
          <EmptyState
            icon={IconFolder}
            title="Dropbox isn't connected"
            detail="Once DROPBOX_ACCESS_TOKEN is set in Vercel, filed usage sheets and the shared resources folder appear here."
          />
        )}

        {state === 'loading' && (
          <>
            <Skeleton width="55%" height={14} />
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ display: 'flex', gap: space.md, alignItems: 'center', padding: `${space.md}px 0` }}>
                <Skeleton width={38} height={38} style={{ borderRadius: radius.control, marginBottom: 0 }} />
                <div style={{ flex: 1 }}>
                  <Skeleton width="60%" height={12} />
                  <Skeleton width="30%" height={10} style={{ marginBottom: 0 }} />
                </div>
              </div>
            ))}
          </>
        )}

        {state === 'error' && (
          <EmptyState icon={IconFolder} title="Couldn't load that folder" detail={error} />
        )}

        {state === 'empty' && (
          <EmptyState
            icon={IconFolder}
            title="Nothing here yet"
            detail={root === 'resources'
              ? 'Drop surgical templates, techniques or implant code lists into the Dropbox resources folder and they will show up here.'
              : 'Usage sheets appear here once a scan has been filed to Dropbox.'}
          />
        )}

        {state === 'ready' && entries.map(entry => {
          const isFolder = entry.kind === 'folder'
          const busy = opening === entry.path
          return (
            <Card key={entry.path} onClick={() => (isFolder ? openFolder(entry) : openFile(entry))}
              style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
              <span style={{
                width: 38, height: 38, borderRadius: radius.control, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isFolder ? colour.accentSoft : colour.canvas,
                color: isFolder ? colour.accent : colour.inkFaint
              }}>
                {isFolder ? <IconFolder size={20} /> : <IconFile size={20} />}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block', wordBreak: 'break-word' }}>
                  {entry.name}
                </span>
                <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block' }}>
                  {busy ? 'Opening…' : [formatWhen(entry.modified), formatSize(entry.size)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span style={{ color: colour.inkFainter, display: 'flex', flexShrink: 0 }}>
                <IconChevron size={18} />
              </span>
            </Card>
          )
        })}

        {state === 'ready' && (
          <div style={{ ...text('caption'), color: colour.inkFainter, textAlign: 'center', marginTop: space.lg }}>
            Files open in Dropbox using a link that expires after a few hours.
          </div>
        )}
      </Body>
    </Page>
  )
}
