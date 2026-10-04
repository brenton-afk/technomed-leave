import React, { useState, useCallback } from 'react'
import { Page, Header, Body, Card, Banner, EmptyState, Skeleton } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { useIsDesktop } from '../design/viewport.js'

// ─── What this patient has had from us ───────────────────────────────────────
// Dropbox stays the store of record: these documents are clinical records with
// a retention life longer than this app's, the admin team already work in
// them, and a second copy would only be a second thing to reconcile. Nothing
// here is downloaded or cached — each file opens through a link Dropbox
// expires after about four hours.
//
// What the app adds is the question the folder tree cannot answer. The tree is
// filed by surgeon and then by month, which is the right way to file and the
// wrong way to look: a patient who saw Thani in 2024 and Garg in 2026 sits in
// two places years apart, and nobody finds the first while looking at the
// second. Before a revision or a removal, that first one is the whole point.
//
// And a tick. Who has been through a case and when — the only thing the app
// holds about a Dropbox folder, because "has anyone checked this?" was being
// answered by asking across the office.

const ICON = {
  pdf: '📄', xlsx: '📊', xls: '📊', jpg: '🖼️', jpeg: '🖼️', png: '🖼️', heic: '🖼️'
}

const extensionOf = name => String(name || '').split('.').pop().toLowerCase()

/** 2026-10-04 → 4 Oct 2026. */
const readableDate = iso => {
  if (!iso) return ''
  const at = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${at.getUTCDate()} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()}`
}

const firstNameOf = email => {
  const name = String(email || '').split('@')[0]
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Someone'
}

export default function PatientHistory({ user, onBack }) {
  const desktop = useIsDesktop()
  const [surname, setSurname] = useState('')
  const [asked, setAsked] = useState('')
  const [state, setState] = useState('idle')
  const [cases, setCases] = useState([])
  const [error, setError] = useState('')
  const [opening, setOpening] = useState('')

  const authHeaders = user?.token ? { Authorization: `Bearer ${user.token}` } : {}

  const search = useCallback(async value => {
    const query = String(value || '').trim()
    if (query.length < 2) {
      setError('Type at least two letters of a surname.')
      return
    }
    setState('loading'); setError(''); setAsked(query)
    try {
      const res = await fetch(
        `/api/usage/agent?action=history&surname=${encodeURIComponent(query)}`,
        { headers: authHeaders })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (!data.configured) { setState('unconfigured'); return }
      setCases(data.cases || [])
      setState((data.cases || []).length ? 'ready' : 'empty')
    } catch (err) {
      // The surname is not put in the message. It is the one thing on this
      // screen that must not end up anywhere it was not already.
      setError(`That search did not work: ${err.message}`)
      setState('error')
    }
    // authHeaders is rebuilt every render; the token inside it is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.token])

  async function openFile(file) {
    setOpening(file.path); setError('')
    try {
      const res = await fetch(
        `/api/usage/agent?action=open&path=${encodeURIComponent(file.path)}`,
        { headers: authHeaders })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      window.open(data.url, '_blank', 'noopener')
    } catch (err) {
      setError(`Could not open that file: ${err.message}`)
    }
    setOpening('')
  }

  async function toggleReviewed(record) {
    const next = !record.reviewed
    // Shown before the server answers. The tick is a note about who looked,
    // not a transaction, and waiting on a round trip to see it move makes it
    // feel broken.
    setCases(list => list.map(c => c.path === record.path
      ? { ...c, reviewed: next ? { by: user?.email, at: new Date().toISOString() } : null }
      : c))
    try {
      const res = await fetch('/api/usage/agent?action=reviewed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ path: record.path, reviewed: next })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setCases(list => list.map(c => c.path === record.path
        ? { ...c, reviewed: data.reviewed } : c))
    } catch (err) {
      setError(`That tick did not save: ${err.message}`)
      setCases(list => list.map(c => c.path === record.path
        ? { ...c, reviewed: record.reviewed } : c))
    }
  }

  return (
    <Page>
      <Header
        eyebrow="Filed usage"
        title="Patient history"
        subtitle="Everything we have filed under a surname, whichever surgeon it was with"
        onBack={onBack} />

      <Body style={desktop ? { maxWidth: 940, boxSizing: 'border-box' } : undefined}>
        <form onSubmit={e => { e.preventDefault(); search(surname) }}
          style={{ display: 'flex', gap: space.sm, marginBottom: space.md }}>
          <input
            value={surname}
            onChange={e => setSurname(e.target.value)}
            aria-label="Patient surname"
            placeholder="Surname"
            autoComplete="off"
            style={{
              flex: 1, minWidth: 0, minHeight: 48, padding: `0 ${space.md}px`,
              borderRadius: radius.control, border: `1px solid ${colour.line}`,
              // 16px or iOS zooms the page on focus and never zooms back.
              fontSize: 16, color: colour.ink, background: colour.surface
            }} />
          <button type="submit"
            style={{
              minHeight: 48, padding: `0 ${space.lg}px`, cursor: 'pointer',
              borderRadius: radius.control, border: 'none', background: colour.navy,
              ...text('bodyStrong'), color: 'white'
            }}>
            Search
          </button>
        </form>

        {error && <Banner tone="danger">{error}</Banner>}

        {state === 'idle' && (
          <EmptyState
            title="Look up a patient"
            detail={'Type a surname to see every case we have filed for them — the scan, '
              + 'the usage sheet, which surgeon and when. Useful before a revision or a removal.'} />
        )}

        {state === 'unconfigured' && (
          <EmptyState
            title="Dropbox isn't connected"
            detail="Once DROPBOX_ACCESS_TOKEN is set in Vercel this reads the filed usage tree." />
        )}

        {state === 'loading' && [0, 1, 2].map(i => (
          <Card key={i}>
            <Skeleton width="45%" height={14} />
            <Skeleton width="70%" height={11} />
            <Skeleton width="30%" height={11} style={{ marginBottom: 0 }} />
          </Card>
        ))}

        {state === 'empty' && (
          <EmptyState
            title={`Nothing filed under "${asked}"`}
            detail={'Either we have not done a case for them, or it was filed under a '
              + 'different spelling. The usage tree only has what has been scanned in.'} />
        )}

        {state === 'ready' && (
          <>
            <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>
              {cases.length} case{cases.length === 1 ? '' : 's'} filed under “{asked}”
            </div>

            {cases.map(record => (
              <CaseRecord
                key={record.path}
                record={record}
                desktop={desktop}
                opening={opening}
                onOpen={openFile}
                onToggle={() => toggleReviewed(record)} />
            ))}
          </>
        )}
      </Body>
    </Page>
  )
}

/** One filed case: what it was, who did it, and what is in the folder. */
function CaseRecord({ record, desktop, opening, onOpen, onToggle }) {
  const when = readableDate(record.date)
  const checked = Boolean(record.reviewed)

  return (
    <Card style={{ marginBottom: space.sm }}>
      <div style={{
        display: 'flex', gap: space.md, alignItems: 'flex-start',
        flexWrap: desktop ? 'nowrap' : 'wrap'
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...text('bodyStrong'), color: colour.ink }}>
            {record.recognised
              ? (record.procedure || 'Procedure not recorded')
              : record.raw}
          </div>
          <div style={{ ...text('caption'), color: colour.inkMuted, marginTop: 2 }}>
            {/* Said in the order somebody asks it: when, with whom, where. An
                unparsed folder says so rather than showing three blanks. */}
            {record.recognised
              ? [when || 'Date not recorded', record.surgeonSurname, record.hospital]
                .filter(Boolean).join(' · ')
              : 'Filed before the app, or under a name it cannot read'}
          </div>
        </div>

        <button type="button" onClick={onToggle}
          aria-pressed={checked}
          aria-label={checked ? 'Mark as not checked' : 'Mark as checked'}
          style={{
            flexShrink: 0, minHeight: 36, padding: `0 ${space.md}px`, cursor: 'pointer',
            borderRadius: radius.pill,
            border: `1px solid ${checked ? colour.accent : colour.line}`,
            background: checked ? colour.accentSoft : 'transparent',
            ...text('caption'), fontWeight: 700,
            color: checked ? colour.accentDeep : colour.inkMuted
          }}>
          {checked ? `✓ Checked by ${firstNameOf(record.reviewed.by)}` : 'Mark checked'}
        </button>
      </div>

      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm
      }}>
        {record.files.map(file => (
          <button key={file.path} type="button"
            onClick={() => onOpen(file)}
            disabled={opening === file.path}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34,
              padding: `0 ${space.md}px`, cursor: 'pointer', borderRadius: radius.pill,
              border: `1px solid ${colour.line}`, background: colour.surface,
              ...text('caption'), color: colour.ink, maxWidth: '100%'
            }}>
            <span aria-hidden="true">{ICON[extensionOf(file.name)] || '📎'}</span>
            <span style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              {/* The file repeats the whole case name with a suffix, which in
                  a row of chips is a wall of the same words. The suffix is
                  the part that says which document this is. */}
              {opening === file.path
                ? 'Opening…'
                : file.name.replace(record.name, '').replace(/^[_-]/, '') || file.name}
            </span>
          </button>
        ))}
        {!record.files.length && (
          <span style={{ ...text('caption'), color: colour.inkFaint }}>
            Folder is empty — the scan may not have finished filing.
          </span>
        )}
      </div>
    </Card>
  )
}
