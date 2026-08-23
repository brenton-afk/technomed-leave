import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  DayBlock, SurgeonLegend, NotesCallout, KeyFlagsSection, PlanFooter, BookingReadings
} from './clinical/PlanBlocks.jsx'
import { tokens, FONT_STACK } from '../clinicalPlan/theme.js'
import { Header } from '../design/Shell.jsx'
import { colour } from '../design/tokens.js'
import {
  resolveDefaultWeek, weekWindowFor, stepWeek, todayStr,
  formatWeekRange, formatDayHeading, formatStamp
} from '../clinicalPlan/week.js'
import { fetchWeekPlan, readCachedPlan, readPrefs, writePrefs, planSignature, LIVE_POLL_MS } from '../clinicalPlan/provider.js'
import { planToText, dayToText } from '../clinicalPlan/exportText.js'
import { DOCX_FILENAME } from '../clinicalPlan/exportMeta.js'

const NAVY = colour.navy

// Weekly is the default on a wide screen and on Fridays (when the new week
// lands); Daily is the default on a phone Mon–Thu, where staff are reading it
// in a corridor and only care about today.
// Opens on today. This is the front door now, and the first thing anyone wants
// is what is on today — the week is one tap away.
function defaultView() {
  const wide = typeof window !== 'undefined' && window.innerWidth >= 640
  return wide ? 'weekly' : 'daily'
}

export default function ClinicalPlan({ user, onBack, promptBanner }) {
  const prefs = useMemo(() => readPrefs(), [])
  const [view, setView] = useState(prefs.view || defaultView())
  const [window_, setWindow] = useState(() =>
    prefs.weekStart ? weekWindowFor(prefs.weekStart) : resolveDefaultWeek())
  const [selectedDay, setSelectedDay] = useState(prefs.selectedDay || todayStr())
  const [plan, setPlan] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | empty | error
  const [staleInfo, setStaleInfo] = useState(null)
  const [errorText, setErrorText] = useState('')
  const [copied, setCopied] = useState('')
  const [docxNotice, setDocxNotice] = useState('')
  const [showReadings, setShowReadings] = useState(false)

  const t = tokens(false)
  const token = user?.token

  // Persist view and date so the tab reopens where it was left.
  useEffect(() => {
    writePrefs({ view, weekStart: window_.startDate, selectedDay })
  }, [view, window_.startDate, selectedDay])

  // What is on screen, so a poll that finds nothing new can leave it alone.
  const shownRef = useRef('')
  const [checkedAt, setCheckedAt] = useState(null)
  // Also held as a ref, because `load` must not depend on it: `load` is a
  // dependency of the effect that runs it, so anything that changes on every
  // poll would make the poll retrigger a full reload.
  const checkedAtRef = useRef(null)

  const load = useCallback(async (win, { force = false, quiet = false } = {}) => {
    if (!quiet) {
      // Show cached content immediately rather than a skeleton over good data.
      const cached = readCachedPlan(win.startDate)
      if (cached) {
        setPlan(cached.plan)
        shownRef.current = planSignature(cached.plan)
        setStatus('ready')
      } else {
        setStatus('loading')
      }
      setErrorText(''); setStaleInfo(null)
    }

    try {
      const result = await fetchWeekPlan(win, { token, force })
      // Only adopt it if something actually changed. A poll usually returns
      // exactly what is already displayed, and replacing it anyway would rebuild
      // the page and throw away the reader's scroll position every minute.
      const signature = planSignature(result.plan)
      if (signature !== shownRef.current) {
        shownRef.current = signature
        setPlan(result.plan)
      }
      checkedAtRef.current = Date.now()
      setCheckedAt(checkedAtRef.current)
      if (result.error) setStaleInfo({ at: result.cachedAt, message: result.error })
      else if (quiet) setStaleInfo(null)
      const hasContent = result.plan.days.some(d =>
        d.casesByHospital.length || d.flags.length || d.nonSurgeonItems.length || d.otherRollup.length)
      setStatus(hasContent ? 'ready' : 'empty')
    } catch (err) {
      // A failed poll must never blank a plan that is already readable.
      if (quiet) { setStaleInfo({ at: checkedAtRef.current, message: err.message }); return }
      // Only reachable with no cache at all — otherwise the provider returns
      // the cached plan with an error attached.
      setStatus('error')
      setErrorText(err.message)
    }
  }, [token])

  useEffect(() => { load(window_) }, [window_, load])

  // Follow the calendar rather than snapshot it. Lists are still being reordered
  // while the plan is being worked from, so an edit made in Google has to appear
  // here without anyone reloading.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') load(window_, { force: true, quiet: true })
    }
    // A tab that has been in the background is the most likely to be out of date,
    // so coming back to it rechecks straight away rather than waiting for the
    // next tick.
    const timer = setInterval(refresh, LIVE_POLL_MS)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [window_, load])

  function goWeek(direction) {
    const next = stepWeek(window_.startDate, direction)
    setWindow(next)
    if (!next.days.includes(selectedDay)) setSelectedDay(next.days[0])
  }

  function goThisWeek() {
    const def = resolveDefaultWeek()
    setWindow(def)
    setSelectedDay(def.days.includes(todayStr()) ? todayStr() : def.days[0])
  }

  // Stepping past either end of the loaded week pulls in the adjacent week.
  function goDay(direction) {
    const all = window_.days
    const index = all.indexOf(selectedDay)
    const nextIndex = index + direction
    if (nextIndex >= 0 && nextIndex < all.length) {
      setSelectedDay(all[nextIndex])
      return
    }
    const nextWindow = stepWeek(window_.startDate, direction)
    setWindow(nextWindow)
    setSelectedDay(direction > 0 ? nextWindow.days[0] : nextWindow.days[6])
  }

  async function copyText() {
    const text = view === 'weekly' ? planToText(plan) : dayToText(plan, selectedDay)
    try {
      await navigator.clipboard.writeText(text)
      setCopied('Copied')
    } catch {
      setCopied('Copy failed — select and copy manually')
    }
    setTimeout(() => setCopied(''), 2500)
  }

  async function downloadDocx() {
    setDocxNotice('')
    try {
      // Loaded on demand: the docx builder is large and most visits never
      // export, so it stays out of the initial bundle.
      const { buildPlanDocx } = await import('../clinicalPlan/exportDocx.js')
      const blob = await buildPlanDocx(plan)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = DOCX_FILENAME
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      // Never block the user — the text copy still works.
      setDocxNotice(`Word export failed (${err.message}). Use "Copy as text" instead.`)
    }
  }

  const dayForDaily = plan?.days.find(d => d.date === selectedDay) || plan?.days[0]

  return (
    <div style={{ minHeight: '100%', background: '#f0f3f7', fontFamily: FONT_STACK }}>
      <style>{`
        @media print {
          .tm-noprint { display: none !important; }
          .tm-plan { padding: 0 !important; background: white !important; }
          body { background: white !important; }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>

      <div className="tm-noprint">
      <Header eyebrow="Case plan" title="Cases" onBack={onBack}>
        {/* View switcher — keyboard operable as a radio group */}
        <div role="radiogroup" aria-label="Plan view" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[['weekly', 'Weekly'], ['daily', 'Daily']].map(([id, label]) => (
            <button key={id} role="radio" aria-checked={view === id} onClick={() => setView(id)}
              style={{
                padding: '7px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                background: view === id ? 'white' : 'rgba(255,255,255,0.12)',
                color: view === id ? NAVY : 'white'
              }}>
              {label}
            </button>
          ))}
        </div>

        {view === 'weekly' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button onClick={() => goWeek(-1)} aria-label="Previous week" style={arrowStyle}>◀</button>
              <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'white' }}>
                {formatWeekRange(window_.startDate, window_.endDate)}
              </div>
              <button onClick={() => goWeek(1)} aria-label="Next week" style={arrowStyle}>▶</button>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button onClick={goThisWeek} style={chipStyle}>This week</button>
              <button onClick={downloadDocx} disabled={!plan} style={chipStyle}>Download .docx</button>
              <button onClick={copyText} disabled={!plan} style={chipStyle}>{copied || 'Copy as text'}</button>
              <button onClick={() => setShowReadings(v => !v)} disabled={!plan}
                aria-pressed={showReadings} style={chipStyle}>
                {showReadings ? 'Hide what was read' : 'Check bookings'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button onClick={() => goDay(-1)} aria-label="Previous day" style={arrowStyle}>◀</button>
              <div style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'white' }}>
                {formatDayHeading(selectedDay)}
              </div>
              <button onClick={() => goDay(1)} aria-label="Next day" style={arrowStyle}>▶</button>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              <button onClick={goThisWeek} style={chipStyle}>Today</button>
              <button onClick={copyText} disabled={!plan} style={chipStyle}>{copied || 'Copy as text'}</button>
            </div>
          </>
        )}

        {plan && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'rgba(255,255,255,0.4)', marginTop: 10 }}>
            {/* Says whether what is on screen can be trusted right now, which
                "last synced" alone does not: the plan is followed live, so the
                useful fact is when it was last checked, not when it was built. */}
            <span aria-hidden="true" style={{
              width: 6, height: 6, borderRadius: 3, flexShrink: 0,
              background: staleInfo ? 'rgba(255,190,90,0.9)' : 'rgba(120,220,180,0.9)'
            }} />
            {staleInfo
              ? `Not updating — showing the last plan that loaded`
              : `Following the calendar · checked ${checkedAt ? formatStamp(checkedAt) : formatStamp(plan.lastGeneratedAt)}`}
          </div>
        )}
      </Header>
      </div>

      {promptBanner}

      <div className="tm-plan" style={{ padding: 16 }}>
        {staleInfo && (
          <div className="tm-noprint" style={{
            background: '#FFF7ED', border: '1px solid #FDBA74', color: '#9A3412',
            borderRadius: 10, padding: '11px 13px', fontSize: 12.5, lineHeight: 1.5, marginBottom: 14
          }}>
            Calendar sync failed — showing last known plan from {formatStamp(new Date(staleInfo.at).toISOString())}
          </div>
        )}
        {docxNotice && (
          <div className="tm-noprint" style={{
            background: '#FFF7ED', border: '1px solid #FDBA74', color: '#9A3412',
            borderRadius: 10, padding: '11px 13px', fontSize: 12.5, marginBottom: 14
          }}>
            {docxNotice}
          </div>
        )}

        {status === 'loading' && <PlanSkeleton />}

        {status === 'error' && (
          <div style={{ background: '#fdecea', color: '#c0392b', padding: 14, borderRadius: 10, fontSize: 13, lineHeight: 1.5 }}>
            Could not load the clinical plan: {errorText}
            <button onClick={() => load(window_, { force: true })}
              style={{ display: 'block', marginTop: 10, padding: '9px 14px', background: 'transparent', border: '1px solid rgba(192,57,43,0.35)', borderRadius: 8, fontSize: 13, color: '#c0392b', cursor: 'pointer' }}>
              Try again
            </button>
          </div>
        )}

        {status === 'empty' && (
          <div style={{ background: 'white', borderRadius: 12, padding: 34, textAlign: 'center', color: t.inkFaint, fontSize: 14 }}>
            No bookings found for this week
          </div>
        )}

        {status === 'ready' && plan && view === 'weekly' && (
          <article>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: t.ink, margin: '0 0 4px', lineHeight: 1.3 }}>{plan.title}</h2>
            <div style={{ fontSize: 12.5, fontStyle: 'italic', color: t.inkMuted, marginBottom: 8 }}>{plan.subtitle}</div>
            <div style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 1.6, marginBottom: 14 }}>{plan.summaryLine}</div>
            <SurgeonLegend surgeons={plan.surgeons} />
            <NotesCallout notes={plan.notes} />
            {plan.days.map(day => <DayBlock key={day.date} day={day} />)}
            <KeyFlagsSection keyFlags={plan.keyFlags} />
            {showReadings && <BookingReadings readings={plan.readings} />}
            <PlanFooter generatedAtLabel={formatStamp(plan.lastGeneratedAt)} />
          </article>
        )}

        {status === 'ready' && plan && view === 'daily' && dayForDaily && (
          <article>
            <SurgeonLegend surgeons={plan.surgeons} />
            <DayBlock day={dayForDaily} headingLevel={2} />
            <PlanFooter generatedAtLabel={formatStamp(plan.lastGeneratedAt)} />
          </article>
        )}
      </div>
    </div>
  )
}

const arrowStyle = {
  width: 34, height: 34, borderRadius: 17, border: 'none',
  background: 'rgba(255,255,255,0.12)', color: 'white', fontSize: 13, cursor: 'pointer', flexShrink: 0
}
const chipStyle = {
  padding: '7px 12px', borderRadius: 18, border: '1px solid rgba(255,255,255,0.22)',
  background: 'transparent', color: 'white', fontSize: 12, cursor: 'pointer'
}

// Matches the document's layout so the page doesn't jump when content arrives.
function PlanSkeleton() {
  const bar = (w, h = 12, mb = 8) => (
    <div style={{ width: w, height: h, background: 'rgba(17,24,39,0.07)', borderRadius: 4, marginBottom: mb }} />
  )
  return (
    <div aria-busy="true" aria-label="Loading clinical plan">
      {bar('70%', 18, 10)}
      {bar('50%', 11)}
      {bar('90%', 11, 18)}
      <div style={{ height: 62, background: 'rgba(17,24,39,0.04)', border: '1px solid rgba(17,24,39,0.07)', borderRadius: 8, marginBottom: 20 }} />
      {[0, 1, 2].map(i => (
        <div key={i} style={{ marginBottom: 22 }}>
          {bar('40%', 14, 6)}
          {bar('26%', 10, 12)}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <div style={{ width: 4, borderRadius: 2, background: 'rgba(17,24,39,0.1)' }} />
            <div style={{ flex: 1 }}>
              {bar('55%', 12, 6)}
              {bar('35%', 10, 6)}
              {bar('25%', 10, 0)}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
