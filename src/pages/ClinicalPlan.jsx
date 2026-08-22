import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  DayBlock, SurgeonLegend, NotesCallout, KeyFlagsSection, PlanFooter
} from './clinical/PlanBlocks.jsx'
import { tokens, FONT_STACK } from '../clinicalPlan/theme.js'
import {
  resolveDefaultWeek, weekWindowFor, stepWeek, todayStr,
  formatWeekRange, formatDayHeading, formatStamp
} from '../clinicalPlan/week.js'
import { fetchWeekPlan, readCachedPlan, readPrefs, writePrefs } from '../clinicalPlan/provider.js'
import { planToText, dayToText } from '../clinicalPlan/exportText.js'
import { DOCX_FILENAME } from '../clinicalPlan/exportMeta.js'

const NAVY = '#042746'

// Weekly is the default on a wide screen and on Fridays (when the new week
// lands); Daily is the default on a phone Mon–Thu, where staff are reading it
// in a corridor and only care about today.
function defaultView() {
  const wide = typeof window !== 'undefined' && window.innerWidth >= 640
  const isFriday = new Date(todayStr() + 'T00:00:00Z').getUTCDay() === 5
  if (wide || isFriday) return 'weekly'
  return 'daily'
}

export default function ClinicalPlan({ user }) {
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

  const t = tokens(false)
  const token = user?.token

  // Persist view and date so the tab reopens where it was left.
  useEffect(() => {
    writePrefs({ view, weekStart: window_.startDate, selectedDay })
  }, [view, window_.startDate, selectedDay])

  const load = useCallback(async (win, { force = false } = {}) => {
    // Show cached content immediately rather than a skeleton over good data.
    const cached = readCachedPlan(win.startDate)
    if (cached) { setPlan(cached.plan); setStatus('ready') } else { setStatus('loading') }
    setErrorText(''); setStaleInfo(null)

    try {
      const result = await fetchWeekPlan(win, { token, force })
      setPlan(result.plan)
      if (result.error) {
        setStaleInfo({ at: result.cachedAt, message: result.error })
      }
      const hasContent = result.plan.days.some(d =>
        d.casesByHospital.length || d.flags.length || d.nonSurgeonItems.length || d.otherRollup.length)
      setStatus(hasContent ? 'ready' : 'empty')
    } catch (err) {
      // Only reachable with no cache at all — otherwise the provider returns
      // the cached plan with an error attached.
      setStatus('error')
      setErrorText(err.message)
    }
  }, [token])

  useEffect(() => { load(window_) }, [window_, load])

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
    <div style={{ minHeight: '100vh', background: '#f0f3f7', fontFamily: FONT_STACK }}>
      <style>{`
        @media print {
          .tm-noprint { display: none !important; }
          .tm-plan { padding: 0 !important; background: white !important; }
          body { background: white !important; }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>

      <div className="tm-noprint" style={{ background: NAVY, paddingTop: 56, paddingLeft: 20, paddingRight: 20, paddingBottom: 16 }}>
        <img src="/logo.png" alt="TechnoMed" style={{ height: 34, width: 'auto', marginBottom: 4 }} />
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>
          Clinical Plan
        </div>

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
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', marginTop: 10 }}>
            Last synced {formatStamp(plan.lastGeneratedAt)}
          </div>
        )}
      </div>

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
