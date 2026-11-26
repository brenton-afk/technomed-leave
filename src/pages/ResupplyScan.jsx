import React, { useState, useEffect, useRef, useCallback } from 'react'
import CameraSheet from './scan/CameraSheet.jsx'
import ScanKindSwitch from './scan/ScanKind.jsx'
import WrongKind from './scan/WrongKind.jsx'
import ScanPages, { NewScanButton } from './scan/ScanPages.jsx'
import { reorder } from './scan/pageList.js'
import { fileToPage, pageFromPreview, filingPages, fitPages, readJson, payloadBytes } from './UsageScan.jsx'
import { releaseCamera } from '../scanner/cameraStream.js'
import { Page, Header, Banner, Button } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { priceCheckLine } from '../usagePriceCheck.js'

// ─── Resupply scanning (Brent, 6 Nov 2026) ───────────────────────────────────
// The paperwork that comes back with the stock — a delivery docket, a packing
// slip, or the photo E4 sends of the box — is photographed with the same
// camera as a usage form, read, matched to the usage case it replaces, and
// filed in that case's folder the way the team already names them. The
// screen answers the question the paper raises: has everything we used come
// back yet? See api/_resupply.js for the rules.

const MAX_PAYLOAD_BYTES = 4_000_000

const newId = () => `rs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const DISTRIBUTOR_CHOICES = [
  ['signus', 'Signus'], ['device', 'Device Technologies'], ['device_boost', 'Device — Boost'],
  ['e4', 'E4 Surgical'], ['kt', 'KT Medical'], ['globus', 'Nuvasive/Globus'], ['dtbv', 'Donor Tissue Bank of Victoria']
]

function formatDay(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || ''
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${iso}T00:00:00Z`))
}

const label = { ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, margin: `${space.md}px 0 ${space.xs}px` }
const panel = { background: colour.surface, border: `1px solid ${colour.line}`, borderRadius: radius.card, padding: space.md, marginBottom: space.sm }

function CaseLine({ c, why }) {
  return (
    <>
      <span style={{ ...text('bodyStrong'), color: colour.ink }}>{c.patientSurname || 'No surname'}</span>
      <span style={{ ...text('caption'), color: colour.inkFaint }}>
        {' '}· {c.surgeonSurname} · {c.hospital} · {formatDay(c.date)}{why?.length ? ` · matched by ${why.join(', ')}` : ''}
      </span>
    </>
  )
}

/**
 * The usage it was matched to, line by line: which used items this paper
 * resupplies, and anything on it the usage did not have. Matching only — what
 * is owed is followed in the existing process (Brent, 10 Nov 2026).
 */
function Comparison({ comparison }) {
  if (!comparison) return null
  const { rows, extras } = comparison
  const onPaper = rows.filter(r => r.now > 0).length
  return (
    <>
    {/* Toni, 20 Nov 2026: an E4 photo of the usage page, with no E4 implant on
        it, was matched and filed as the E4 resupply. The case is found by the
        patient on the paper; this says plainly when nothing on it is that
        supplier's product from the usage. */}
    {rows.length > 0 && onPaper === 0 && (
      <Banner tone="warning" data-nothing-matched>
        Nothing on this paper matches this supplier's items on the usage. Check it is the resupply
        itself (the docket, or a photo of the stock), not the usage form or another supplier's paper.
      </Banner>
    )}
    <div style={panel}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, marginBottom: space.sm }}>
        <span style={{ ...text('heading'), color: colour.ink }}>Matched to the usage</span>
        <span style={{ ...text('caption'), color: colour.inkFaint }}>
          {onPaper} of {rows.length} usage line{rows.length === 1 ? '' : 's'} on this paper
        </span>
      </div>
      {rows.map(r => (
        <div key={r.key} data-resupply-row style={{
          display: 'flex', gap: space.sm, alignItems: 'baseline', padding: '6px 0',
          borderTop: `1px solid ${colour.lineSoft}`
        }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ ...text('caption'), fontWeight: 700, color: colour.ink, display: 'block' }}>{r.product}</span>
            <span style={{ ...text('micro'), textTransform: 'none', letterSpacing: 0, color: colour.inkFaint }}>{r.referenceCode || 'no code'}</span>
          </span>
          <span style={{ ...text('caption'), whiteSpace: 'nowrap', color: r.now ? colour.accentDeep : colour.inkFaint, fontWeight: r.now ? 700 : 400 }}>
            {r.now ? `${r.now} on this paper ✓` : 'not on this paper'}
          </span>
        </div>
      ))}
      {extras.length > 0 && (
        <div style={{ marginTop: space.sm }}>
          <div style={{ ...text('caption'), fontWeight: 700, color: colour.ink }}>
            On this paper but not on the usage
          </div>
          {extras.map((l, i) => (
            <div key={i} style={{ ...text('caption'), color: colour.inkFaint }}>
              {l.quantity} × {l.description || l.referenceCode} {l.referenceCode && `(${l.referenceCode})`}
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  )
}

/**
 * The paper's codes against the distributor price lists the portal keeps
 * (Brent, 19 Nov 2026). Lines that check out are counted; a code on another
 * distributor's list, or on none, is shown with what to do. Never a price.
 */
function PriceCodes({ resupply, onUseCode, onUseDistributor }) {
  const lines = resupply.lines.filter(l => priceCheckLine(l))
  if (!lines.length && !resupply.listSuggests) return null
  const ok = lines.filter(l => priceCheckLine(l).tone === 'ok')
  const warn = lines.filter(l => priceCheckLine(l).tone !== 'ok')
  const btn = { ...text('caption'), fontWeight: 600, marginLeft: space.xs, padding: '2px 8px', borderRadius: radius.control,
    border: `1px solid ${colour.accent}`, background: colour.surface, color: colour.accentDeep, cursor: 'pointer' }
  const suggest = resupply.listSuggests && resupply.listSuggests.distributorKey !== resupply.distributorKey ? resupply.listSuggests : null
  return (
    <div data-resupply-price-codes style={panel}>
      <div style={{ ...text('heading'), color: colour.ink, marginBottom: space.xs }}>Codes on the price list</div>
      {resupply.distributorFromList && resupply.distributor && (
        <div style={{ ...text('caption'), color: colour.inkFaint }}>Distributor taken from the codes: {resupply.distributor}.</div>
      )}
      {suggest && (
        <div data-price-suggest style={{ ...text('caption'), color: colour.warning, marginTop: space.xs }}>
          ⚠ Most of these codes are on {suggest.distributor}'s price list.
          <button type="button" style={btn} onClick={() => onUseDistributor(suggest.distributorKey)}>It's from {suggest.distributor}</button>
        </div>
      )}
      {ok.length > 0 && (
        <div style={{ ...text('caption'), color: colour.accentDeep, marginTop: space.xs }}>
          ✓ {ok.length} of {lines.length} code{lines.length === 1 ? '' : 's'} on {resupply.distributor || 'the distributor'}'s list
        </div>
      )}
      {warn.map(l => {
        const pc = priceCheckLine(l)
        return (
          <div key={l.id} data-price-check={l.priceCheck.status} style={{ ...text('caption'), color: colour.warning, padding: '6px 0', borderTop: `1px solid ${colour.lineSoft}`, marginTop: space.xs }}>
            <span style={{ color: colour.ink, fontWeight: 700 }}>{l.referenceCode}</span>
            {l.description && <span style={{ color: colour.inkFaint }}> · {l.description}</span>}
            <div>⚠ {pc.text}
              {pc.near && <button type="button" data-price-near style={btn} onClick={() => onUseCode(l.id, pc.near)}>Use {pc.near}</button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Search every scanned usage by surname, surgeon or folder name. */
function FindCase({ headers, exclude = [], onPick }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [busy, setBusy] = useState(false)
  async function search(e) {
    e?.preventDefault()
    if (q.trim().length < 2) return
    setBusy(true)
    try {
      const res = await fetch(`/api/usage/agent?action=resupply-find&q=${encodeURIComponent(q.trim())}`, { headers })
      const data = await res.json()
      setFound((data.cases || []).filter(c => !exclude.includes(c.id)))
    } catch { setFound([]) }
    setBusy(false)
  }
  return (
    <form onSubmit={search} style={{ ...panel, display: 'grid', gap: space.xs }}>
      <span style={{ ...text('caption'), color: colour.inkFaint }}>Not listed? Find the case by surname, surgeon or folder name</span>
      <span style={{ display: 'flex', gap: space.xs }}>
        <input id="resupply-find" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Ware"
          aria-label="Find a usage case"
          style={{ ...text('body'), fontSize: 16, flex: 1, minWidth: 0, minHeight: 40, padding: '0 10px',
            border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink }} />
        <button type="submit" disabled={busy} style={{ ...text('bodyStrong'), minHeight: 40, padding: '0 14px', borderRadius: radius.control,
          border: `1px solid ${colour.line}`, background: colour.surface, color: colour.ink, cursor: 'pointer' }}>
          {busy ? 'Finding…' : 'Find'}
        </button>
      </span>
      {found.map(c => (
        <button key={c.id} type="button" onClick={() => { onPick(c); setFound([]); setQ('') }}
          style={{ textAlign: 'left', background: 'none', border: 'none', borderTop: `1px solid ${colour.lineSoft}`, padding: '8px 0', cursor: 'pointer' }}>
          <CaseLine c={c} />
        </button>
      ))}
      {!busy && q && found.length === 0 && <span style={{ ...text('micro'), textTransform: 'none', letterSpacing: 0, color: colour.inkFaint }}>Press Find to search every scanned usage.</span>}
    </form>
  )
}

export default function ResupplyScan({ user, kind, onKind, initialPages, onReadAsUsage }) {
  const [step, setStep] = useState('home')
  const [pages, setPages] = useState([])
  const pagesRef = useRef([])
  const [showCamera, setShowCamera] = useState(false)
  const [readWhenReady, setReadWhenReady] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [read, setRead] = useState(null)        // { resupply, candidates }
  const [usageId, setUsageId] = useState(null)
  const [comparison, setComparison] = useState(null)
  const [naming, setNaming] = useState(null)
  const [saved, setSaved] = useState(null)
  // The reader says these pages are a usage form (scan/WrongKind.jsx).
  const [wrongKind, setWrongKind] = useState(false)
  const scanId = useRef(newId())
  const uploadRef = useRef(null)

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token || ''}` }

  useEffect(() => () => releaseCamera(), [])

  // Pages brought across from the Usage scanner ("Read it as a resupply"): read straight away.
  useEffect(() => {
    if (!initialPages?.length) return
    pagesRef.current = initialPages
    setPages(initialPages)
    setStep('capture')
    setReadWhenReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addPages = useCallback(added => {
    const next = [...pagesRef.current, ...added]
    if (payloadBytes(next) > MAX_PAYLOAD_BYTES) {
      setError('That is as many pages as one resupply can take. Read these first.')
      return false
    }
    pagesRef.current = next
    setPages(next)
    setError('')
    return true
  }, [])

  async function addFiles(list) {
    try {
      const added = []
      for (const file of Array.from(list || [])) added.push(await fileToPage(file))
      if (added.length) { addPages(added); setStep('capture') }
    } catch (err) { setError(err.message) }
  }

  function startNew() {
    pagesRef.current = []
    scanId.current = newId()
    setPages([]); setRead(null); setUsageId(null); setComparison(null); setNaming(null); setSaved(null); setError('')
    setStep('capture'); setShowCamera(true)
  }

  useEffect(() => {
    if (!readWhenReady || !pages.length || busy) return
    setReadWhenReady(false)
    readIt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readWhenReady, pages.length, busy])

  async function readIt() {
    setStep('reading'); setBusy(true); setError('')
    try {
      const res = await fetch('/api/usage/agent?action=resupply-read', {
        method: 'POST', headers,
        body: JSON.stringify({ pages: pagesRef.current.map(p => ({ mediaType: p.mediaType, data: p.data })) })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (!data.resupply) throw new Error('The resupply came back empty. Try the photograph again.')
      const settled = (data.matchedId && data.naming?.distributorKey) || data.resupply.distributorKey
      setRead({ resupply: { ...data.resupply, distributorKey: settled }, candidates: data.candidates || [] })
      setUsageId(data.matchedId || null)
      setComparison(data.comparison || null)
      setNaming(data.matchedId ? data.naming || null : null)
      setWrongKind(data.resupply.documentKind === 'usage' && Boolean(onReadAsUsage))
      setStep('review')
    } catch (err) {
      setError(err.message); setStep('capture')
    }
    setBusy(false)
  }

  // With a case: the comparison and the codes checked again. Without one
  // (`recheck`): the codes only — after a code is corrected or the
  // distributor changed.
  async function compareWith(id, resupply = read.resupply, { recheck = false } = {}) {
    setUsageId(id); setComparison(null); setNaming(null)
    if (!id && !recheck) return
    try {
      const res = await fetch('/api/usage/agent?action=resupply-compare', {
        method: 'POST', headers, body: JSON.stringify({ usageId: id, resupply })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (id) setComparison(data.comparison)
      setNaming(id ? data.naming || null : null)
      // The supplier the name settles on (Device or Boost, from the paper and
      // the usage) is the one shown — the portal decides it, not the picker.
      const settled = (id && data.naming?.distributorKey) || resupply.distributorKey
      if (data.resupply) setRead(r => ({ ...r, resupply: { ...data.resupply, distributorKey: settled } }))
      else if (settled !== resupply.distributorKey) setRead(r => ({ ...r, resupply: { ...r.resupply, distributorKey: settled } }))
    } catch (err) { setError(err.message) }
  }

  function setDistributor(key) {
    const resupply = { ...read.resupply, distributorKey: key, distributorFromList: false }
    setRead({ ...read, resupply })
    compareWith(usageId, resupply, { recheck: true })
  }

  function useCode(lineId, code) {
    const resupply = { ...read.resupply, lines: read.resupply.lines.map(l => (l.id === lineId ? { ...l, referenceCode: code } : l)) }
    setRead({ ...read, resupply })
    compareWith(usageId, resupply, { recheck: true })
  }

  async function save() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/usage/agent?action=resupply-save', {
        method: 'POST', headers,
        body: JSON.stringify({ id: scanId.current, usageId, resupply: read.resupply, pages: await fitPages(pagesRef.current) })
      })
      const data = await readJson(res)
      if (data.error) throw new Error(data.error)
      setSaved(data)
      setStep('done')
    } catch (err) { setError(err.message) }
    setBusy(false)
  }

  // The Usage | Resupply switch, except mid-scan — as on the Usage side,
  // switching then would drop the pages already taken.
  const header = (title, subtitle) => (
    <Header title={title} subtitle={subtitle}>
      {!(pages.length && ['capture', 'reading', 'review'].includes(step)) && <ScanKindSwitch kind={kind} onChange={onKind} />}
    </Header>
  )

  // ── Reading ──
  if (step === 'reading') {
    return (
      <Page>
        {header('Reading the resupply…', 'Finding the case it belongs to. This can take up to a minute.')}
      </Page>
    )
  }

  // ── The paper is a usage form: ask before matching or filing anything ──
  if (step === 'review' && read && wrongKind) {
    return (
      <Page>
        {header('Is this a resupply?', `${pages.length} page${pages.length === 1 ? '' : 's'} read`)}
        <div style={{ padding: space.lg }}>
          <WrongKind looksLike="usage" onMove={() => onReadAsUsage(pagesRef.current)} onStay={() => setWrongKind(false)} />
        </div>
      </Page>
    )
  }

  // ── Review ──
  if (step === 'review' && read) {
    const { resupply, candidates } = read
    const chosen = candidates.find(c => c.id === usageId)
    return (
      <Page>
        {header('Check the resupply', 'Nothing is recorded until you save it')}
        <div style={{ padding: space.md }}>
          {error && <Banner tone="danger">{error}</Banner>}

          <div style={label}>From</div>
          <div style={panel}>
            <select aria-label="Distributor" value={resupply.distributorKey || ''}
              onChange={e => setDistributor(e.target.value || null)}
              style={{ ...text('bodyStrong'), fontSize: 16, width: '100%', minHeight: 40, border: `1px solid ${colour.line}`, borderRadius: radius.control, background: colour.surface, color: colour.ink }}>
              <option value="">Which distributor?</option>
              {DISTRIBUTOR_CHOICES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
            <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.xs }}>
              {[resupply.documentNumber && `No. ${resupply.documentNumber}`, resupply.documentDate && formatDay(resupply.documentDate),
                `${resupply.lines.length} line${resupply.lines.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
            </div>
          </div>

          <div style={label}>For the case</div>
          {candidates.length === 0 && (
            <Banner tone="warning">
              No scanned usage matches this. Find the case below, or record it without one — it will not be
              filed in a case folder, so file it by hand if the usage was never scanned.
            </Banner>
          )}
          {candidates.map(c => (
            <label key={c.id} style={{ ...panel, display: 'flex', gap: space.sm, alignItems: 'center', cursor: 'pointer',
              borderColor: c.id === usageId ? colour.accent : colour.line }}>
              <input type="radio" name="case" checked={c.id === usageId} onChange={() => compareWith(c.id)} style={{ fontSize: 16 }} />
              <span><CaseLine c={c} why={c.why} /></span>
            </label>
          ))}
          {candidates.length > 0 && (
            <label style={{ ...panel, display: 'flex', gap: space.sm, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="case" checked={!usageId} onChange={() => compareWith(null)} style={{ fontSize: 16 }} />
              <span style={{ ...text('caption'), color: colour.inkFaint }}>None of these</span>
            </label>
          )}
          {/* Not offered? Find it by name (Erin, 10 Nov 2026). */}
          <FindCase headers={headers} exclude={candidates.map(c => c.id)} onPick={c => {
            setRead(r => ({ ...r, candidates: [...r.candidates.filter(x => x.id !== c.id), { ...c, why: ['found by name'] }] }))
            compareWith(c.id)
          }} />

          <PriceCodes resupply={resupply} onUseCode={useCode} onUseDistributor={setDistributor} />

          {chosen && naming?.fileName && (
            <div data-resupply-name style={{ ...panel, borderColor: colour.accent }}>
              <div style={{ ...text('caption'), color: colour.inkFaint }}>Will be filed in the case folder as</div>
              <div style={{ ...text('bodyStrong'), color: colour.ink, wordBreak: 'break-word' }}>{naming.fileName}</div>
              <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>{naming.why.join(' · ')}</div>
            </div>
          )}
          {usageId && !comparison && <div style={{ ...text('caption'), color: colour.inkFaint }}>Comparing…</div>}
          {chosen && <Comparison comparison={comparison} />}

          {!usageId && resupply.lines.length > 0 && (
            <div style={panel}>
              {resupply.lines.map(l => (
                <div key={l.id} style={{ ...text('caption'), color: colour.ink }}>
                  {l.quantity} × {l.description || l.referenceCode} {l.referenceCode && `(${l.referenceCode})`}
                </div>
              ))}
            </div>
          )}

          <Button onClick={save} disabled={busy || !resupply.lines.length || (usageId && !comparison)}>
            {busy ? 'Saving…' : chosen ? 'Record and file in the case folder' : 'Record it'}
          </Button>
          <div style={{ height: space.sm }} />
          <Button variant="quiet" onClick={() => setStep('capture')}>Back to the pages</Button>
        </div>
      </Page>
    )
  }

  // ── Done ──
  if (step === 'done' && saved) {
    return (
      <Page>
        {header(saved.alreadySaved ? 'Already recorded' : 'Resupply recorded',
          saved.case ? `${saved.case.patientSurname} · ${saved.case.surgeonSurname} · ${formatDay(saved.case.date)}` : 'Not matched to a case')}
        <div style={{ padding: space.md }}>
          {saved.entry?.filed && <Banner>Filed in the case folder as “{saved.entry.filed}”.</Banner>}
          {saved.fileError && <Banner tone="warning">Recorded, but not filed in Dropbox ({saved.fileError}). File the paper by hand.</Banner>}
          <Comparison comparison={saved.comparison} />
          <NewScanButton label="Scan another resupply" onClick={startNew} />

        </div>
      </Page>
    )
  }

  // ── Capture ──
  if (step === 'capture') {
    return (
      <Page>
        {header('Add pages', 'Photograph or upload every page of the resupply')}
        <div style={{ padding: space.md }}>
          {error && <Banner tone="danger">{error}</Banner>}
          <input ref={uploadRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none', fontSize: 16 }}
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <ScanPages pages={pages} busy={busy}
            scanLabel="Scan the resupply"
            hint="The docket, packing slip or the photo that came with the stock — hold the phone over it."
            onScan={() => setShowCamera(true)}
            onUpload={() => uploadRef.current?.click()}
            onRemove={id => { pagesRef.current = pages.filter(x => x.id !== id); setPages(pagesRef.current) }}
            onMove={(id, by) => { const next = reorder(pages, id, by); if (next !== pages) { pagesRef.current = next; setPages(next) } }}
            onRead={readIt} />
          <button type="button" onClick={() => setStep('home')}
            style={{ width: '100%', minHeight: 44, background: 'transparent', border: 'none', ...text('bodyStrong'), color: colour.inkFaint, cursor: 'pointer' }}>
            Back
          </button>
        </div>
        {showCamera && (
          <CameraSheet
            pageCount={pages.length}
            onCapture={page => addPages([pageFromPreview(page, pages.length + 1)])}
            onDone={() => setShowCamera(false)}
            onRead={() => { setShowCamera(false); setReadWhenReady(true) }}
            onCancel={() => setShowCamera(false)}
            onFallback={() => { setShowCamera(false); uploadRef.current?.click() }} />
        )}
      </Page>
    )
  }

  // ── Home: the scan card ──
  return (
    <Page>
      {header('Add pages', 'Photograph or upload every page of the resupply')}
      <div style={{ padding: space.md }}>
        {error && <Banner tone="danger">{error}</Banner>}
        <input ref={uploadRef} type="file" accept="image/*,application/pdf" multiple style={{ display: 'none', fontSize: 16 }}
          onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        {/* The same first screen as the Usage side (Brent, 6 Nov 2026). The
            Still owed list that sat under it is gone (Brent, 10 Nov 2026: the
            existing process follows what is owed; this only matches to usage). */}
        <ScanPages pages={[]} busy={false}
          scanLabel="Scan the resupply"
          hint="The docket, packing slip or the photo that came with the stock — hold the phone over it."
          onScan={startNew}
          onUpload={() => uploadRef.current?.click()} />

      </div>
    </Page>
  )
}
