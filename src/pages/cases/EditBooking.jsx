import React, { useState, useEffect, useCallback, useMemo } from 'react'
import LoanTrail from './LoanTrail.jsx'
import Fold from './Fold.jsx'
import KitPicker from './KitPicker.jsx'
import { Overlay } from '../../design/Shell.jsx'
import { CaseThread } from '../Chat.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import {
  GOOGLE_COLOR_NAMES, GOOGLE_COLOR_HEX, guideColorIdFor, colourNameFor
} from '../../clinicalPlan/colours.js'
import { zonedCivil, toDateStr, weekdayName, TZ, todayStr } from '../../clinicalPlan/week.js'
import {
  extractRep, isCancelled, isSelfFunding, normaliseSurgeon, parseCaseTitle
} from '../../clinicalPlan/parse.js'
import { needsPriorImplants } from '../../clinicalPlan/priorImplants.js'
import { fetchDayCases } from '../../clinicalPlan/provider.js'
import { dayShortfall } from '../../clinicalPlan/inventory.js'
import { systemsInKit, findNavigation, findSystems, LOAN_SETS } from '../../clinicalPlan/systems.js'
import {
  SUPPLY_OPTIONS, parseKitSupplies, setSupply, systemsToSupply, drawsOnLocalStock
} from '../../clinicalPlan/kitSupply.js'
import { ATTENDING_REPS, ALLOCATABLE_REPS } from '../../staffConfig.js'
import { queueBookingSave, isNetworkFailure } from '../../offlineQueue.js'
import { attendanceNotRequired } from '../../clinicalPlan/attendance.js'
import { offerNotices } from '../../notices.js'

// ─── Amending a booking from the portal ──────────────────────────────────────
// Tap a case, change it, and it lands on the calendar the whole team reads.
//
// Three things shape this, and all three are about not doing damage:
//
// 1. It loads the booking fresh rather than editing the case object the week
//    plan built. The plan holds *derived* values — the system uppercased, the
//    supply lifted out of the kit line — and saving those would write the app's
//    rendering back over what the team typed.
//
// 2. Only changed fields are sent, and the server patches each in place. The
//    portal holds a patient's surname and nothing else by policy, so rebuilding
//    the description would delete the "(Donna)" somebody recorded on purpose.
//
// 3. The version marker goes back with the save. Several people edit this
//    calendar during a list; without it the last write silently wins and the
//    other person's change is gone with nothing to say it existed.

const FIELDS = [
  { key: 'patient', label: 'Patient surname', hint: 'Surname only — anything else in the booking is kept' },
  { key: 'surgeon', label: 'Surgeon' },
  { key: 'procedure', label: 'Procedure' },
  // The hint is a fixed format example, and it used to say "as written:
  // \"Diplomat (Consignment)\"" under a booking whose kit was CYLOX — which
  // read as another booking's data leaking in. It now only appears while the
  // field is empty, and says plainly that it is an example.
  { key: 'kit', label: 'Kit', emptyHint: 'System, then supply in brackets — for example "Diplomat (Consignment)"' },
  { key: 'hospital', label: 'Hospital' }
]

/**
 * The Hobart date and clock time of an instant, for the form.
 *
 * Never the device's. A rep in Melbourne opening a booking must see the time the
 * theatre list actually starts, and saving must not shift it by an hour.
 */
function civilParts(iso) {
  if (!iso || !String(iso).includes('T')) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const c = zonedCivil(at, TZ)
  const pad = n => String(n).padStart(2, '0')
  return { date: toDateStr(c), time: `${pad(c.hour)}:${pad(c.minute)}` }
}

function Field({ label, hint, value, onChange, autoFocus, type = 'text' }) {
  return (
    <label style={{ display: 'block', marginBottom: space.md }}>
      <span style={{
        ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
        display: 'block', marginBottom: 4
      }}>{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        style={{ fontSize: 16,
          width: '100%', padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
          border: `1px solid ${colour.line}`, borderRadius: radius.control,
          ...text('body'), color: colour.ink, background: colour.surface, outline: 'none'
        }} />
      {hint && (
        <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 2 }}>
          {hint}
        </span>
      )}
    </label>
  )
}

/**
 * A title that still names a value the booking no longer has.
 *
 * Changing the surgeon in the description leaves "Mardon DIPLOMAT - Fowler"
 * saying Fowler, and the title is what shows in Google's month view — so the
 * calendar would contradict itself. The portal proposes the corrected title and
 * waits to be told: rewriting it automatically would silently reformat titles
 * people wrote by hand, and anything unusual in one would be lost.
 */
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ─── The kit in the title ─────────────────────────────────────────────────────
// "Issue with portal not changing/updating the KIT/system in the TITLE /event
// heading in the google calendar" — Toni, 3 Nov 2026, on the Diplomat to
// Mariner cases. The title names the system the team's way ("Smith DIPLOMAT -
// Thani") while the field says "Diplomat (Consignment)", so the whole-value
// match below never found the old kit in the title and nothing changed. The
// kit is compared by *system* instead: what left the kit is found in the title
// and what arrived takes its place, in capitals, as the team writes it.

const kitParts = kit => [
  ...systemsInKit(kit),
  ...LOAN_SETS.filter(set => set.test.test(String(kit || ''))).map(set => set.name)
]

export function kitTitle(title, beforeKit, afterKit) {
  const was = kitParts(beforeKit)
  const now = kitParts(afterKit)
  const gone = was.filter(n => !now.includes(n))
  const added = now.filter(n => !was.includes(n))
  if (!gone.length && !added.length) return null

  const inTitle = [
    ...findSystems(title).map(f => ({ name: f.name, matched: f.matched })),
    ...LOAN_SETS.map(set => ({ name: set.name, matched: (set.test.exec(title) || [])[0] })).filter(f => f.matched)
  ]
  const leaving = inTitle.filter(f => gone.includes(f.name))
  // Nothing of the old kit is written in the title — a placeholder or a title
  // typed some other way — so there is nothing to swap, and it is left alone.
  if (!leaving.length) return null
  // As the kit line words it ("Mariner MIS", not the family name "Mariner"),
  // without its supply in brackets.
  const wording = name => {
    const entry = parseKitSupplies(afterKit).find(e => kitParts(e.system).includes(name))
    return String(entry?.system || name).trim().toUpperCase()
  }
  const arriving = added.filter(n => !inTitle.some(f => f.name === n)).map(wording)

  const esc = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let proposed = title
  leaving.forEach((hit, i) => {
    if (i === 0 && arriving.length) {
      proposed = proposed.replace(hit.matched, arriving.join(' + '))
      return
    }
    // Taken off with one separator beside it, so "DIPLOMAT + E4 BMD" becomes
    // "E4 BMD" rather than "+ E4 BMD".
    const m = esc(hit.matched)
    for (const pattern of [new RegExp(`${m}\\s*[/+]\\s*`), new RegExp(`\\s*[/+]\\s*${m}`), new RegExp(m)]) {
      if (pattern.test(proposed)) { proposed = proposed.replace(pattern, ' '); break }
    }
  })
  proposed = proposed.replace(/\s{2,}/g, ' ').replace(/\s+-\s+/, ' - ').trim()
  if (proposed === title.trim()) return null
  return { field: 'kit', was: leaving.map(h => h.matched).join(', '), now: arriving.join(' + '), proposed }
}

export function staleTitle(summary, before, after) {
  const title = String(summary || '')
  const kitChange = String(before?.kit || '').trim() !== String(after?.kit || '').trim()
    ? kitTitle(title, before?.kit, after?.kit) : null
  // The surname and surgeon first, then the kit on whatever they leave.
  const people = staleTitleOf(title, before, after, ['surgeon', 'patient'])
  if (people && kitChange) {
    const both = kitTitle(people.proposed, before?.kit, after?.kit)
    return both ? { ...people, proposed: both.proposed } : people
  }
  return people || kitChange || staleTitleOf(title, before, after, ['kit'])
}

function staleTitleOf(title, before, after, keys) {
  for (const key of keys) {
    const was = String(before?.[key] || '').trim()
    const now = String(after?.[key] || '').trim()
    if (!was || !now || was === now) continue

    // Already says it. "Lloyd" corrected to "Lloyd Jones" over a title that
    // already reads "Lloyd Jones DIPLOMAT" would otherwise match "Lloyd" and
    // write "Lloyd Jones Jones".
    if (new RegExp(`\\b${escape(now)}\\b`, 'i').test(title)) continue

    // The title's surname is spelled differently from the field — "the event
    // title had a different spelling from the surname field" — so the old
    // value is not in it to be found. The surname leads the title by the
    // team's own convention, so the leading words are replaced, as many as
    // the old value had. The title follows the fields, never the reverse.
    if (key === 'patient' && !new RegExp(`\\b${escape(was)}\\b`, 'i').test(title)) {
      // Only where the title plainly opens with the surname: a title that
      // leads with CANCELLED or a self-funding marker is left for a person.
      if (isCancelled(title, '') || isSelfFunding(title, '')) continue
      const read = parseCaseTitle(extractRep(title).rest)
      const lead = read?.patient ? title.trim().slice(0, read.patient.length) : ''
      if (lead && lead.toLowerCase() === read.patient.toLowerCase()
        && /\s/.test(title.trim().charAt(lead.length))) {
        return { field: key, was: lead, now, proposed: now + title.trim().slice(lead.length) }
      }
      continue
    }

    // The whole value first, then its last word. A description reads
    // "Surg - Dr Ibbett" while the title says only "Ibbett" — the live
    // convention on this calendar — so matching the whole value alone would
    // miss every titled surgeon who has a "Dr" in front of them.
    const candidates = [was]
    const lastWord = was.split(/\s+/).pop()
    if (lastWord && lastWord !== was && lastWord.length > 1) candidates.push(lastWord)

    for (const candidate of candidates) {
      // Whole word only: replacing a fragment would corrupt an unrelated word,
      // and "Al" inside "Calvary" is not a surgeon.
      const pattern = new RegExp(`\\b${escape(candidate)}\\b`, 'i')
      if (!pattern.test(title)) continue
      // Replaced with the new value's last word too, so "Dr Ibbett" becoming
      // "Dr Fowler" does not write "Dr Fowler" where the title had a bare name.
      const replacement = candidate === was ? now : (now.split(/\s+/).pop() || now)
      return { field: key, was: candidate, now: replacement, proposed: title.replace(pattern, replacement) }
    }
  }
  return null
}

/**
 * The booking's colour in Google.
 *
 * Not chosen — derived. The colour is a function of who is operating (the guide
 * says Ibbett is Banana), so asking a person to pick it is asking them to look
 * up a table and get it right, which is how bookings ended up uncoloured or
 * wrong to begin with. The server sets it from the surgeon on every save, so
 * editing anything about a booking also puts its colour right.
 *
 * This is therefore mostly a statement of what will happen. The palette is
 * behind a tap, for a surgeon the guide has no opinion about and for the day
 * somebody genuinely wants something else — automatic is a default, not a lock.
 */
function ColourPicker({ value, surgeon, chosen, onChange, onClear }) {
  const [open, setOpen] = useState(false)
  const expected = guideColorIdFor(
    String(surgeon || '').replace(/^(dr|mr|mrs|ms|prof|a\/prof)\b\.?\s*/i, '').trim().split(/\s+/).pop())
  const willBe = chosen ? value : (expected || value)

  return (
    <div style={{ marginBottom: space.md }}>
      <span style={{
        ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
        display: 'block', marginBottom: 4
      }}>Colour in the calendar</span>

      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
        <span aria-hidden="true" style={{
          width: 24, height: 24, borderRadius: radius.pill, flexShrink: 0,
          background: GOOGLE_COLOR_HEX[willBe] || colour.line,
          border: `1px solid ${colour.line}`
        }} />
        <span style={{ ...text('caption'), color: colour.inkMuted, flex: 1 }}>
          {willBe ? colourNameFor(willBe) : 'No colour set'}
          {!chosen && expected && (
            <span style={{ color: colour.inkFainter }}> — set automatically from {surgeon}</span>
          )}
          {chosen && <span style={{ color: colour.inkFainter }}> — chosen for this booking</span>}
        </span>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{
            ...text('caption'), cursor: 'pointer', background: 'none',
            border: `1px solid ${colour.line}`, borderRadius: radius.control,
            padding: `4px ${space.sm}px`, color: colour.inkMuted, flexShrink: 0
          }}>
          {open ? 'Done' : 'Change'}
        </button>
      </div>

      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
          {Object.keys(GOOGLE_COLOR_NAMES).map(id => {
            const on = String(willBe || '') === id
            return (
              <button key={id} type="button" onClick={() => onChange(id)}
                aria-label={GOOGLE_COLOR_NAMES[id]} aria-pressed={on}
                title={GOOGLE_COLOR_NAMES[id] + (id === expected ? ' — the guide' : '')}
                style={{
                  width: 30, height: 30, borderRadius: radius.pill, cursor: 'pointer',
                  background: GOOGLE_COLOR_HEX[id],
                  border: on ? `3px solid ${colour.ink}` : `1px solid ${colour.line}`,
                  outline: id === expected ? `2px dashed ${colour.inkFaint}` : 'none',
                  outlineOffset: 2
                }} />
            )
          })}
          {chosen && expected && (
            <button type="button" onClick={onClear}
              style={{
                ...text('caption'), cursor: 'pointer', background: 'none',
                border: `1px solid ${colour.line}`, borderRadius: radius.control,
                padding: `4px ${space.sm}px`, color: colour.inkMuted
              }}>
              Back to automatic
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A title carrying who attended.
 *
 * The team writes it as a bracketed suffix — "Marsh DIPLOMAT - Ibbett
 * (Aimee/Mat)" — so this rewrites that group rather than inventing a field. Any
 * existing group is replaced, so choosing nobody removes it cleanly.
 */
/**
 * The title with its rep group replaced.
 *
 * Uses the same reader the app displays from, rather than a second pattern of
 * its own. The two had already drifted: this one only recognised the four names
 * in ATTENDING_REPS, so editing a booking that said "(Aimee/Brenton)" would
 * have left that group in place and appended a second one.
 */
export function withReps(summary, reps) {
  const base = extractRep(String(summary || '')).rest
  return reps.length ? `${base} (${reps.join('/')})` : base
}

/**
 * Where each system's kit is coming from, as buttons.
 *
 * "I need a Loan/Consignment button from within the booking editor so we can
 * tap that instead of having to write what kit we are using for each case."
 *
 * A row per system, because one case is often two systems with different
 * answers — Consignment Ascot and RHH Loan Athlet for an Ascot/Athlet case at
 * Calvary, because Ascot lives at Calvary and Athlet does not. A single choice
 * for the whole booking could not say that, which is why it was being typed
 * out by hand.
 *
 * It writes into the Kit field rather than alongside it. The field is still
 * there and still editable: somebody who wants to write "(2 levels, from
 * Melbourne)" can, and the buttons read back whatever is in it.
 */
function KitSupply({ kit, system, onChange }) {
  const systems = systemsToSupply({ kit, system })
  if (!systems.length) return null
  const chosen = new Map(parseKitSupplies(kit).map(e => [e.system.toLowerCase(), e.supply]))

  return (
    <div style={{ marginBottom: space.md }}>
      <span style={{
        ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
        display: 'block', marginBottom: 6
      }}>Where the kit is coming from</span>

      {systems.map(name => (
        <div key={name} style={{ marginBottom: space.sm }}>
          <span style={{
            ...text('caption'), color: colour.ink, fontWeight: 700,
            display: 'block', marginBottom: 4
          }}>{name}</span>
          {/* Two by two on a phone, four across where there is room. A row
              of four at 360px gives each button 80px, and "Distributor
              Loan" is not an 80px word — it wrapped to three lines and the
              row of buttons became a block of text. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SUPPLY_OPTIONS.map(option => {
              const on = chosen.get(name.toLowerCase()) === option
              return (
                <button key={option} type="button"
                  aria-pressed={on}
                  aria-label={`${name}: ${option}`}
                  onClick={() => onChange(setSupply(kit || system, name, option))}
                  style={{
                    flexGrow: 1, flexShrink: 1, flexBasis: '40%',
                    minHeight: 40, cursor: 'pointer', padding: '0 4px',
                    borderRadius: radius.control,
                    border: `1px solid ${on ? colour.accent : colour.line}`,
                    background: on ? colour.accentSoft : colour.surface,
                    ...text('caption'), fontWeight: on ? 700 : 400,
                    color: on ? colour.accentDeep : colour.inkMuted
                  }}>
                  {option}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block' }}>
        Tap the same one again to clear it.
      </span>
    </div>
  )
}

// How a line in the booking's loan log reads. See api/_bookingNotices.js
// recordLoanRequest.
const LOAN_LOG_WORD = { request: 'Requested from', update: 'Change sent to', cancel: 'Called off with', hospital: 'Told' }
function loanLogWhen(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Hobart' })
}

export default function EditBooking({
  eventId, user, onClose, onSaved, onPreferences, hasPreferences
}) {
  // The booking's own thread. Opened from here because this is where somebody
  // already is when they think of the question.
  const [thread, setThread] = useState(false)
  const [loaded, setLoaded] = useState(null)
  const [fields, setFields] = useState({})
  const [notes, setNotes] = useState('')
  const [when, setWhen] = useState({ date: '', start: '', end: '' })
  const [colorId, setColorId] = useState(null)
  // An explicit pick. Without one the server derives the colour from the
  // surgeon, so sending nothing is how "automatic" is expressed.
  const [colourChosen, setColourChosen] = useState(false)
  const [status, setStatus] = useState('loading')
  // The day Google confirmed a moved booking is now on.
  const [movedTo, setMovedTo] = useState(null)
  const [error, setError] = useState('')
  // Two taps, deliberately. A booking removed by accident is a case nobody
  // knows about, and the calendar keeps no undo the team can reach.
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Calling the case off, which is not deleting it. One tap to ask, one to
  // confirm — the same two-tap rule as delete, because a case cancelled by
  // accident sends nobody to a theatre that is expecting them.
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [reason, setReason] = useState('')
  // Who was in the room. Chosen, never typed: it goes into the booking title,
  // and a spelling the roster does not know is a rep the app cannot read back.
  const [reps, setReps] = useState([])
  // Who the team leader has allocated (Task 10). Several, because reps often
  // go together. Editable only by that week's team leader (or an admin).
  const [planned, setPlanned] = useState([])
  // "No usage for this case" — stops the 6pm reminder. Saved straight away,
  // separately from the booking, because it is not a change to the case.
  const [noUsage, setNoUsage] = useState(false)
  // What else is booked on the day this booking is headed for. Refetched when
  // the date changes, because moving a booking onto a day whose kit is already
  // committed is the same clash as booking a second one there.
  const [dayCases, setDayCases] = useState([])

  const auth = user?.token ? { Authorization: `Bearer ${user.token}` } : {}

  const calledOff = Boolean(loaded && isCancelled(loaded.summary || '', loaded.notes || ''))

  // What this patient already has in — looked up only when the booking asks.
  // A history panel on every case is a panel nobody reads, and this one has to
  // be read on the cases that have it.
  const [prior, setPrior] = useState(null)
  const asksAboutExisting = needsPriorImplants(
    `${fields.procedure || ''} ${notes || ''} ${loaded?.summary || ''}`)

  useEffect(() => {
    if (!asksAboutExisting || !fields.patient) { setPrior(null); return undefined }
    let live = true
    const query = new URLSearchParams({
      action: 'prior', patient: fields.patient, surgeon: fields.surgeon || ''
    })
    fetch(`/api/calendar/today?${query}`, { headers: auth })
      .then(r => r.json())
      .then(data => { if (live) setPrior(data) })
      .catch(() => { if (live) setPrior(null) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asksAboutExisting, fields.patient, fields.surgeon, user?.token])

  /** Calls the case off, or puts it back on. */
  async function setCancelled(off) {
    setStatus('saving'); setError('')
    try {
      const res = await fetch('/api/calendar/today?action=cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ eventId, off, reason, etag: loaded?.etag })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That did not go through')
      offerNotices(data)
      setConfirmCancel(false)
      setReason('')
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message)
      setStatus('ready')
    }
  }

  const load = useCallback(async () => {
    setStatus('loading'); setError('')
    try {
      const res = await fetch(`/api/calendar/today?action=booking&id=${encodeURIComponent(eventId)}`,
        { headers: auth })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      // A 200 carrying something that is not a booking — the app shell served
      // mid-deploy, an auth redirect followed quietly — used to get as far as
      // the render and throw there, on loaded.fields being undefined. That is
      // a white screen with no header and no way back out of it, which is the
      // one thing this app is not allowed to do. Caught here instead, where
      // there is already a message and a Close button.
      if (!data.fields) throw new Error('That booking could not be read. Try again.')
      setLoaded(data)
      setFields({ ...data.fields })
      setNotes(data.notes || '')
      const from = civilParts(data.start)
      const to = civilParts(data.end)
      setWhen({ date: from?.date || '', start: from?.time || '', end: to?.time || '' })
      setColorId(data.colorId || null)
      setColourChosen(false)
      setReps(data.reps || [])
      setPlanned(data.planned || [])
      setNoUsage(Boolean(data.noUsage))
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, user?.token])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    let current = true
    if (!when.date) { setDayCases([]); return undefined }
    fetchDayCases(when.date, { token: user?.token })
      .then(cases => { if (current) setDayCases(cases) })
      // A day that cannot be read is not a reason to block an edit; it only
      // means this one check cannot be made.
      .catch(() => { if (current) setDayCases([]) })
    return () => { current = false }
  }, [when.date, user?.token])

  const originalWhen = loaded
    ? { date: civilParts(loaded.start)?.date || '', start: civilParts(loaded.start)?.time || '',
        end: civilParts(loaded.end)?.time || '' }
    : null
  // Only a real change of day. A booking whose loaded start cannot be read
  // (all-day, or a shape this sheet does not expect) has no date to have
  // moved from, and announcing "Moving this booking to…" over it is exactly
  // the false message that was reported.
  const movedTime = Boolean(originalWhen?.date && when.date && when.date !== originalWhen.date)
  const recoloured = colourChosen

  /** RHH or CLV, from any of the ways a hospital is written. */
  const siteOf = text => {
    const t = String(text || '').toUpperCase()
    if (/\bCLV\b|CALVARY|LENAH/.test(t)) return 'CLV'
    if (/\bRHH\b|ROYAL\s*HOBART/.test(t)) return 'RHH'
    return null
  }

  /**
   * Kit this booking needs that its day does not have enough of.
   *
   * Counted against the day it is going to, not the day it came from, and with
   * this booking's own entry taken out so it is not counted twice.
   */
  const shortfalls = useMemo(() => {
    const site = siteOf(fields.hospital)
    if (!site) return []
    const mine = systemsInKit(fields.kit || '')
    const others = dayCases.filter(c => c.id !== eventId)
    return mine.map(system => {
      // Only the cases actually competing for what is on the hospital's
      // shelf. A case with a loan set booked brings its own kit, so counting
      // it here produced "borrow one from RHH" for a day where every case
      // already had a tray coming — advice to fetch something nobody needed.
      const alsoBooked = others.filter(c =>
        siteOf(c.hospital) === site
        && systemsInKit(`${c.system || ''} ${c.kit || ''}`).includes(system)
        && drawsOnLocalStock(c.kit || c.system, system)).length
      const meToo = drawsOnLocalStock(fields.kit || fields.system, system) ? 1 : 0
      return dayShortfall(system, site, alsoBooked + meToo)
    }).filter(Boolean)
  }, [fields.hospital, fields.kit, fields.system, dayCases, eventId])

  const repsChanged = Boolean(loaded && reps.join('/') !== (loaded.reps || []).join('/'))
  const plannedChanged = Boolean(loaded && planned.join('/') !== (loaded.planned || []).join('/'))

  const changed = loaded && (
    FIELDS.some(f => (fields[f.key] || '') !== (loaded.fields?.[f.key] || ''))
    || notes !== (loaded.notes || '') || movedTime || recoloured || repsChanged || plannedChanged)

  async function save({ withTitle, base = loaded } = {}) {
    setStatus('saving'); setError('')
    try {
      // The title pass sends the title and nothing else. Everything else
      // landed in the first pass; resending it against the booking as it was
      // *before* that pass is what made the portal's own save look like
      // somebody else's — see the two-pass note below.
      const body = withTitle
        ? { eventId, etag: base.etag, fields: {}, summary: withTitle }
        : (() => {
          // Only what actually changed. A field sent unchanged is a field that
          // can be reformatted by a round trip for no reason.
          const patch = {}
          for (const f of FIELDS) {
            if ((fields[f.key] || '') !== (base.fields[f.key] || '')) patch[f.key] = fields[f.key] || ''
          }
          if (plannedChanged) patch.planned = planned.join(' / ')
          return {
            eventId,
            etag: base.etag,
            fields: patch,
            ...(notes !== (base.notes || '') ? { notes } : {}),
            // Naive local times plus the zone on the server, never an offset
            // worked out here: the phone's timezone must not move a theatre list.
            ...(movedTime && when.date && when.start && when.end
              ? { start: `${when.date}T${when.start}:00`, end: `${when.date}T${when.end}:00` }
              : {}),
            ...(colourChosen ? { colorId } : {}),
            // Who attended lives in the title — "(Aimee/Mat)" — so recording it
            // is a title change, written from the chosen names rather than typed.
            ...(repsChanged ? { summary: withReps(base.summary, reps) } : {})
          }
        })()

      // No signal: the change is kept on this phone and sent when there is.
      // One pass rather than two — the title goes with the fields — because
      // nobody will be here to start a second pass. See offlineQueue.js.
      const holdForLater = () => {
        const stale = withTitle ? null : staleTitle(base.summary, base.fields, fields)
        queueBookingSave({
          eventId,
          body: stale ? { ...body, summary: stale.proposed } : body,
          label: [fields.patient, fields.surgeon].filter(Boolean).join(' / '),
          email: user?.email
        })
        setStatus('queued')
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { holdForLater(); return }

      let res
      try {
        res = await fetch('/api/calendar/today?action=save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...auth },
          body: JSON.stringify(body)
        })
      } catch (err) {
        if (isNetworkFailure(err)) { holdForLater(); return }
        throw err
      }
      const data = await res.json()

      if (res.status === 409) {
        setStatus('conflict')
        setError('Somebody changed this booking in Google while you had it open.')
        return
      }
      if (data.error) throw new Error(data.error)
      // Suppliers this change concerns, for somebody to confirm. See NoticeSheet.
      offerNotices(data)

      // The title follows the fields, without being asked.
      //
      // It used to stop and offer, every time, on the reasoning that the title
      // is what everybody reads on the calendar and rewriting it silently is a
      // surprise. That was wrong about where the surprise is: somebody who has
      // just corrected the surname in the edit screen has already said what
      // they want the booking to say, and being asked again — on every edit,
      // forever — is a second step for a decision that was made in the first.
      //
      // Reported as: "it asks me to update the title when I update the
      // booking. I don't want it to ask me every time, I just want the title
      // automatically updated if I edit it in the edit booking screen."
      //
      // Saved in two passes rather than one, because the description has to
      // land first: a title rewritten from fields that failed to save would be
      // the one genuinely bad outcome here.
      //
      // The second pass carries the version marker the *first* pass got back.
      // It used to read `loaded` from the render that started the save — the
      // marker from before this sheet's own write — so Google refused it, and
      // the sheet said "Somebody changed this booking in Google while you had
      // it open" about a change it had made itself, and the title never saved.
      if (!withTitle) {
        const stale = staleTitle(data.event?.summary || base.summary, base.fields, fields)
        if (stale) {
          const next = {
            ...base,
            etag: data.event?.etag || base.etag,
            summary: data.event?.summary || base.summary,
            fields: { ...fields },
            notes
          }
          setLoaded(next)
          await save({ withTitle: stale.proposed, base: next })
          return
        }
      }

      // A move is confirmed rather than closed on. "Show the user a confirmation
      // of the new date after the calendar update succeeds" — the server only
      // answers once Google has the event on the new day, so this is the
      // calendar's word, not the form's.
      const landed = String(data.event?.start || '').slice(0, 10)
      if (movedTime && landed) {
        onSaved?.()
        setMovedTo(landed)
        setStatus('moved')
        return
      }

      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message)
      setStatus('ready')
    }
  }

  async function remove() {
    setStatus('saving'); setError('')
    try {
      const res = await fetch('/api/calendar/today?action=delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ eventId, etag: loaded?.etag })
      })
      const data = await res.json()
      if (res.status === 409) {
        setStatus('conflict')
        setError('Somebody changed this booking in Google while you had it open.')
        return
      }
      if (data.error) throw new Error(data.error)
      offerNotices(data)
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message)
      setStatus('ready')
      setConfirmDelete(false)
    }
  }

  // The booking in the shape the preference lookup expects. Built from the
  // fields as they stand rather than from what was loaded, so a surgeon
  // corrected in this sheet opens the corrected surgeon's card.
  // The platform this case needs, read off the operation and the kit. Same
  // rules as the week and the calendar colour; see systems.js.
  const navigation = findNavigation(
    [fields.procedure, fields.kit, fields.system].filter(Boolean).join(' ')).join(' + ')

  const asCase = {
    // Normalised, because the field holds whatever the calendar says — "Dr
    // Ibbett", "PETERS-WILLKE" — and the preference lookup is keyed on the
    // name this app files them under. Without this the button offers itself
    // and then opens nothing, which is worse than not offering it.
    surgeon: normaliseSurgeon(fields.surgeon) || fields.surgeon || '',
    system: fields.system || '',
    operation: fields.procedure || '',
    kit: fields.kit || ''
  }

  return (
    <>
    {thread && (
      <CaseThread
        eventId={eventId}
        subtitle={[loaded?.patient, loaded?.surgeon].filter(Boolean).join(' · ')}
        user={user}
        onClose={() => setThread(false)} />
    )}
    <Overlay>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
        }}>
        <div
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-label="Edit booking"
          className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 460,
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
            display: 'flex', flexDirection: 'column'
          }}>

          <div style={{
            padding: `${space.md}px ${space.md}px ${space.sm}px`,
            borderBottom: `1px solid ${colour.line}`, flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
              <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Edit booking</span>
              <button onClick={onClose} aria-label="Close"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  ...text('body'), color: colour.inkFaint, padding: space.xs
                }}>Close</button>
            </div>
            {loaded?.summary && (
              <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>
                {loaded.summary}
              </div>
            )}
          </div>

          {/* overflowX is not redundant beside overflowY.
              
              CSS computes a `visible` axis to `auto` when the other axis is
              scrollable, so setting only overflowY quietly turns on sideways
              scrolling too — and the sheet pans off the screen under a thumb
              that was trying to scroll up. Reported on this sheet; it was true
              of all eleven scroll regions in the app, and is now spelled out
              in every one of them. See the guard in sheets.test.jsx. */}
          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden', flex: 1 }}>
            {status === 'moved' && movedTo && (
              <div role="status" style={{
                background: colour.successSoft, border: `1px solid ${colour.line}`,
                borderRadius: radius.control, padding: space.md, marginBottom: space.md
              }}>
                <div style={{ ...text('bodyStrong'), color: colour.success }}>
                  Moved to {weekdayName(movedTo)} {movedTo}
                </div>
                <div style={{ ...text('caption'), color: colour.ink, marginTop: 2 }}>
                  The calendar entry itself has moved — there is one booking, on the new day.
                </div>
                <button onClick={onClose} style={{
                  marginTop: space.sm, width: '100%', padding: space.sm, cursor: 'pointer',
                  ...text('bodyStrong'), color: 'white', background: colour.accent,
                  border: 'none', borderRadius: radius.control
                }}>Done</button>
              </div>
            )}

            {status === 'queued' && (
              <div role="status" style={{
                background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
                borderRadius: radius.control, padding: space.md, marginBottom: space.md
              }}>
                <div style={{ ...text('bodyStrong'), color: colour.ink }}>
                  No signal — saved on this phone
                </div>
                <div style={{ ...text('caption'), color: colour.ink, marginTop: 2 }}>
                  It will go to the calendar by itself as soon as you are back in range.
                  The bar at the top of the app shows it until it has.
                </div>
                <button onClick={onClose} style={{
                  marginTop: space.sm, width: '100%', padding: space.sm, cursor: 'pointer',
                  ...text('bodyStrong'), color: 'white', background: colour.accent,
                  border: 'none', borderRadius: radius.control
                }}>Done</button>
              </div>
            )}

            {status === 'loading' && (
              <div style={{ ...text('body'), color: colour.inkFaint, textAlign: 'center', padding: space.lg }}>
                Loading the booking…
              </div>
            )}

            {/* Shown above everything, because it is about the day rather
                than about this booking, and moving a case is exactly when it
                is easiest to miss. */}
            {shortfalls.map(short => (
              <div key={short.system} style={{
                background: colour.dangerSoft, border: `1px solid ${colour.dangerLine}`,
                borderRadius: radius.control, padding: space.sm, marginBottom: space.md
              }}>
                <div style={{ ...text('bodyStrong'), color: colour.danger }}>
                  {short.from
                    ? `Borrow a ${short.system} kit from ${short.from}`
                    : `A ${short.system} loan set is needed`}
                </div>
                <div style={{ ...text('caption'), color: colour.ink, marginTop: 2 }}>
                  {short.reason}
                </div>
              </div>
            ))}

            {error && (
              <div style={{
                background: status === 'conflict' ? colour.warningSoft : colour.dangerSoft,
                border: `1px solid ${status === 'conflict' ? colour.warningLine : colour.dangerLine}`,
                color: status === 'conflict' ? colour.warning : colour.danger,
                borderRadius: radius.control, padding: space.sm, marginBottom: space.md,
                ...text('caption')
              }}>
                {error}
                {status === 'conflict' && (
                  <div style={{ marginTop: space.sm }}>
                    <button onClick={load}
                      style={{
                        ...text('caption'), fontWeight: 700, cursor: 'pointer',
                        background: 'none', border: `1px solid ${colour.warningLine}`,
                        borderRadius: radius.control, padding: `4px ${space.sm}px`,
                        color: colour.warning
                      }}>
                      Reload theirs and start again
                    </button>
                  </div>
                )}
              </div>
            )}

            {loaded && status !== 'loading' && !['moved', 'queued'].includes(status) && !loaded.allDay && (
              <>
                <Field label="Date" type="date" value={when.date}
                  onChange={v => setWhen(c => ({ ...c, date: v }))} />
                {/* No start or finish. Case timings are not settled until the
                    list order lands the evening before and then move several
                    times a day, so a time here is wrong almost immediately and
                    editing it is work with no value. The booking keeps whatever
                    hours it has; only the day moves. */}
                {movedTime && (
                  <div style={{ ...text('caption'), color: colour.accentDeep, marginTop: -space.sm, marginBottom: space.md }}>
                    Moving this booking to {weekdayName(when.date)} {when.date}.
                  </div>
                )}
              </>
            )}

            {loaded && status !== 'loading' && !['moved', 'queued'].includes(status) && (
              <>
                {FIELDS.map((f, i) => (f.key === 'kit' ? (
                  // The kit folds to one line ("Mariner MIS (Distributor
                  // Loan)") — its system and supply buttons were most of what
                  // made this screen busy. Open when there is no kit yet.
                  <Fold key={f.key} label="Kit" summary={(fields.kit || '').trim()} empty="No kit yet"
                    defaultOpen={!(fields.kit || '').trim()}>
                    <Field label={f.label}
                      hint={f.hint || (!(fields[f.key] || '').trim() ? f.emptyHint : undefined)}
                      value={fields[f.key] || ''}
                      onChange={v => setFields(c => ({ ...c, [f.key]: v }))} />
                    {/* Under the kit field, because it writes into it. Tapping
                        a button and typing the same thing have to produce one
                        field, or the two disagree the first time somebody
                        uses both. */}
                    <KitPicker systemsOnly kit={fields.kit || ''}
                      onChange={next => setFields(c => ({ ...c, kit: next }))} />
                    <KitSupply
                      kit={fields.kit || ''}
                      system={fields.system || ''}
                      onChange={next => setFields(c => ({ ...c, kit: next }))} />
                  </Fold>
                ) : (
                  <Field key={f.key} label={f.label} autoFocus={i === 0}
                    hint={f.hint || (!(fields[f.key] || '').trim() ? f.emptyHint : undefined)}
                    value={fields[f.key] || ''}
                    onChange={v => setFields(c => ({ ...c, [f.key]: v }))} />
                )))}

                {/* ── What the room has to have set up ──
                    
                    AIRO is off the phone tile now — it reads the same on
                    every pedicle screw case, which is most of a spine list —
                    and "still be able to go into each booking and get the
                    extra info" is only true if it is actually in here. It is
                    derived from the operation and the kit every time, as it
                    is everywhere else, so correcting a procedure corrects
                    this without anybody editing a second field. */}
                {navigation && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginBottom: space.md, padding: `${space.sm}px ${space.md}px`,
                    borderRadius: radius.control,
                    background: colour.surface, border: `1px solid ${colour.line}`
                  }}>
                    <span style={{
                      ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint
                    }}>Navigation</span>
                    <span style={{ ...text('bodyStrong'), color: colour.ink }}>
                      {navigation}
                    </span>
                  </div>
                )}

                {/* ── Loan sets asked for ──
                    "Once the request for a loan set is sent to the
                    distributor, the portal is updated to say that the request
                    was made, by whom and at what time and date." Newest first,
                    every request, change and call-off, and the hospital's
                    loans team being told. */}
                {(loaded?.loanLog || []).length > 0 && (
                  <Fold label="Requested"
                    summary={`${LOAN_LOG_WORD[loaded.loanLog[0].hospital ? 'hospital' : loaded.loanLog[0].status] || 'Emailed'} ${loaded.loanLog[0].to} · ${loaded.loanLog[0].by || 'someone'}`}>
                    {loaded.loanLog.map((l, i) => (
                      <div key={i} style={{ ...text('caption'), color: i === 0 ? colour.ink : colour.inkMuted, marginBottom: 2 }}>
                        <strong>{LOAN_LOG_WORD[l.hospital ? 'hospital' : l.status] || 'Emailed'}</strong>
                        {' '}{l.to}{l.systems?.length ? ` — ${l.systems.join(' + ')}` : ''}
                        {' · '}{l.by || 'someone'}, {loanLogWhen(l.at)}
                      </div>
                    ))}
                  </Fold>
                )}

                {/* ── The distributor loan set, and the emails behind it ──
                    Loads by itself; shows nothing on a booking with no
                    distributor loan. See LoanTrail. */}
                {loaded?.id && <LoanTrail eventId={loaded.id} user={user} />}

                {/* ── How this surgeon likes the room ──
                    
                    "The preferences button could be inside the booking
                    itself."
                    
                    It was on the card, beside the list order, on the grounds
                    that those are the two things somebody wants at half past
                    seven. The list order is still there — it is a thing you
                    change about the day. A preference card is a thing you
                    read, and reading belongs where the rest of the booking is
                    rather than on a tile meant to be glanced at.
                    
                    Under the kit, because that is what it is about: the
                    booking names the surgeon and the system, so this opens
                    the right card rather than a list to search. */}
                {onPreferences && hasPreferences?.(asCase) && (
                  <button type="button"
                    aria-label={`Preferences for ${asCase.surgeon || 'this case'}`}
                    onClick={() => onPreferences(asCase)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', minHeight: 48, marginBottom: space.md,
                      padding: `0 ${space.md}px`, cursor: 'pointer',
                      borderRadius: radius.control,
                      border: `1px solid ${colour.line}`, background: colour.surface,
                      ...text('bodyStrong'), color: colour.ink
                    }}>
                    <span aria-hidden="true">★</span>
                    Preferences{asCase.surgeon ? ` — ${asCase.surgeon}` : ''}
                    <span aria-hidden="true" style={{
                      marginLeft: 'auto', color: colour.inkFaint
                    }}>›</span>
                  </button>
                )}

                <Fold label="Notes" summary={notes.split('\n').find(l => l.trim())?.trim() || ''} defaultOpen={false}>
                <label style={{ display: 'block', marginBottom: space.sm }}>
                  <textarea aria-label="Notes"
                    value={notes}
                    rows={4}
                    onChange={e => setNotes(e.target.value)}
                    style={{ fontSize: 16,
                      width: '100%', padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
                      border: `1px solid ${colour.line}`, borderRadius: radius.control,
                      ...text('body'), color: colour.ink, background: colour.surface,
                      outline: 'none', resize: 'vertical', fontFamily: 'inherit'
                    }} />
                  <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 2 }}>
                    Why it moved, who called it in, what still has to be ordered
                  </span>
                </label>
                </Fold>

                <Fold label="People"
                  summary={[planned.length ? `Planned ${planned.join(' + ')}` : '', reps.length ? `Attended ${reps.join(' + ')}` : ''].filter(Boolean).join(' · ')}
                  empty="Nobody allocated yet">

                <div style={{ marginBottom: space.md }}>
                  <span style={{
                    ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
                    display: 'block', marginBottom: 4
                  }}>Planned</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(loaded.canAllocate
                      ? [...ALLOCATABLE_REPS, ...planned.filter(r => !ALLOCATABLE_REPS.includes(r))]
                      : planned
                    ).map(name => {
                      const on = planned.includes(name)
                      return (
                        <button key={name} type="button" aria-pressed={on} disabled={!loaded.canAllocate}
                          aria-label={`Planned: ${name}`}
                          onClick={() => setPlanned(list => (on ? list.filter(r => r !== name) : [...list, name]))}
                          style={{
                            padding: `6px ${space.md}px`, borderRadius: radius.pill,
                            cursor: loaded.canAllocate ? 'pointer' : 'default', ...text('bodyStrong'),
                            background: on ? colour.accentSoft : colour.surface,
                            color: on ? colour.accentDeep : colour.inkMuted,
                            border: `1px solid ${on ? colour.accent : colour.line}`
                          }}>
                          {name}
                        </button>
                      )
                    })}
                    {!loaded.canAllocate && !planned.length && (
                      <span style={{ ...text('caption'), color: colour.inkFaint }}>Nobody allocated yet</span>
                    )}
                  </div>
                  <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 2 }}>
                    {loaded.canAllocate
                      ? 'Who you are sending — tap as many as are going'
                      : 'Allocated by the team leader'}
                  </span>
                </div>

                <div style={{ marginBottom: space.md }}>
                  <span style={{
                    ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
                    display: 'block', marginBottom: 4
                  }}>Rep attending</span>
                  {/* Actual defaults to planned: one tap when it went as allocated. */}
                  {planned.length > 0 && reps.join('/') !== planned.join('/') && (
                    <button type="button" onClick={() => setReps(planned)} style={{
                      ...text('caption'), fontWeight: 700, cursor: 'pointer', marginBottom: 6,
                      background: 'none', border: `1px solid ${colour.line}`, borderRadius: radius.pill,
                      padding: `4px ${space.sm}px`, color: colour.accentDeep
                    }}>
                      As planned — {planned.join(' + ')}
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {/* The roster, plus anyone already on this booking who is
                        not on it. A locum or a name from another company would
                        otherwise be invisible here and quietly dropped the next
                        time somebody saved. */}
                    {[...ATTENDING_REPS, ...reps.filter(r => !ATTENDING_REPS.includes(r))].map(name => {
                      const on = reps.includes(name)
                      return (
                        <button key={name} type="button" aria-pressed={on}
                          onClick={() => setReps(list =>
                            on ? list.filter(r => r !== name) : [...list, name])}
                          style={{
                            padding: `6px ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer',
                            ...text('bodyStrong'),
                            background: on ? colour.accent : colour.surface,
                            color: on ? 'white' : colour.inkMuted,
                            border: `1px solid ${on ? colour.accent : colour.line}`
                          }}>
                          {name}
                        </button>
                      )
                    })}
                  </div>
                  <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 2 }}>
                    Goes into the booking title, as the team already writes it
                  </span>
                </div>
                </Fold>

                {/* Only once the case has happened or is happening. */}
                {when.date && when.date <= todayStr() && (
                  <div style={{ marginBottom: space.md }}>
                    <button type="button" aria-pressed={noUsage}
                      onClick={async () => {
                        const next = !noUsage
                        setNoUsage(next)
                        try {
                          const res = await fetch('/api/calendar/today?action=nousage', {
                            method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
                            body: JSON.stringify({ eventId, on: next })
                          })
                          if (!res.ok) throw new Error()
                        } catch {
                          setNoUsage(!next)
                          setError('Could not save "No usage" — try again')
                        }
                      }}
                      style={{
                        padding: `6px ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer', ...text('bodyStrong'),
                        background: noUsage ? colour.accent : colour.surface,
                        color: noUsage ? 'white' : colour.inkMuted,
                        border: `1px solid ${noUsage ? colour.accent : colour.line}`
                      }}>
                      No usage
                    </button>
                    <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 2 }}>
                      Nothing was used — stops the 6pm "usage not sent" reminder
                    </span>
                  </div>
                )}

                {/* "No F2F" as a button rather than a phrase to remember. It
                    writes the line the team already writes by hand, which is
                    what marks the card "We are not needed". */}
                {(() => {
                  const NO_F2F = /^\s*no f2f required\s*$/im
                  const on = NO_F2F.test(notes) || attendanceNotRequired(`${notes}\n${loaded?.summary || ''}`)
                  const handTyped = on && !NO_F2F.test(notes)
                  return (
                    <div style={{ marginBottom: space.md }}>
                      <button type="button" aria-pressed={on} disabled={handTyped}
                        onClick={() => setNotes(n => on
                          ? n.replace(NO_F2F, '').replace(/\n{3,}/g, '\n\n').trim()
                          : [n.trim(), 'No F2F required'].filter(Boolean).join('\n'))}
                        style={{
                          padding: `6px ${space.md}px`, borderRadius: radius.pill,
                          cursor: handTyped ? 'default' : 'pointer', ...text('bodyStrong'),
                          background: on ? colour.accent : colour.surface,
                          color: on ? 'white' : colour.inkMuted,
                          border: `1px solid ${on ? colour.accent : colour.line}`
                        }}>
                        No F2F
                      </button>
                      <span style={{ ...text('caption'), color: colour.inkFainter, display: 'block', marginTop: 2 }}>
                        {handTyped
                          ? 'Already marked not needed in the booking text'
                          : 'Nobody from TechnoMed needed in the room'}
                      </span>
                    </div>
                  )
                })()}

                <ColourPicker
                  value={colorId}
                  surgeon={fields.surgeon}
                  chosen={colourChosen}
                  onChange={id => { setColorId(id); setColourChosen(true) }}
                  onClear={() => { setColourChosen(false); setColorId(loaded.colorId || null) }} />

                {prior?.matches?.length > 0 && (
                  <div style={{
                    marginTop: space.lg, padding: space.md,
                    background: colour.warningSoft,
                    border: `1px solid ${colour.warningLine}`, borderRadius: radius.control
                  }}>
                    <div style={{ ...text('bodyStrong'), color: colour.ink }}>
                      Already filed under this surname
                    </div>
                    {/* Hedged on purpose. A surname is all this app keeps, so
                        the honest claim is about the record, not the patient. */}
                    <div style={{ ...text('caption'), color: colour.inkMuted, marginBottom: space.sm }}>
                      {prior.summary}
                    </div>
                    {prior.matches.map((m, i) => (
                      <div key={i} style={{
                        ...text('caption'), color: colour.ink, marginBottom: 4
                      }}>
                        <strong>{m.date || 'date not in the name'}</strong>
                        {m.surgeon ? ` · ${m.surgeon}` : ''}
                        {m.sameSurgeon ? '' : ' (different surgeon)'}
                        {m.systems?.length ? ` · ${m.systems.join(' + ')}` : ''}
                        <span style={{ display: 'block', color: colour.inkFainter }}>
                          {m.filedAs}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {prior?.unavailable && asksAboutExisting && (
                  <div style={{
                    marginTop: space.lg, ...text('caption'), color: colour.inkFaint
                  }}>
                    Could not check what is already in: {prior.unavailable}
                  </div>
                )}

                {/* Calling the case off. Kept out of the footer, which already
                    has three buttons and would be four on a phone — and kept
                    well away from Delete, because they are not the same thing
                    and only one of them is reversible. */}
                <div style={{
                  marginTop: space.lg, paddingTop: space.md,
                  borderTop: `1px solid ${colour.line}`
                }}>
                  {calledOff ? (
                    <>
                      <div style={{
                        ...text('bodyStrong'), color: colour.ink,
                        background: colour.warningSoft, border: `1px solid ${colour.warningLine}`,
                        borderRadius: radius.control, padding: space.sm, marginBottom: space.sm
                      }}>
                        This case is called off.
                      </div>
                      <button onClick={() => setCancelled(false)} disabled={status === 'saving'}
                        style={{
                          width: '100%', padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
                          background: 'transparent', color: colour.accentDeep,
                          border: `1px solid ${colour.accent}`, borderRadius: radius.control
                        }}>
                        {status === 'saving' ? 'Putting it back…' : 'Put the case back on'}
                      </button>
                    </>
                  ) : (
                    <>
                      {confirmCancel && (
                        <label style={{ display: 'block', marginBottom: space.sm }}>
                          <span style={{
                            ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
                            display: 'block', marginBottom: 4
                          }}>Why, if you know</span>
                          <input value={reason} onChange={e => setReason(e.target.value)}
                            placeholder="Patient unwell, list overran…"
                            aria-label="Reason it was called off"
                            style={{
                              width: '100%', padding: `${space.sm}px ${space.md}px`,
                              boxSizing: 'border-box', border: `1px solid ${colour.line}`,
                              borderRadius: radius.control, ...text('field'),
                              color: colour.ink, background: colour.surface, outline: 'none'
                            }} />
                          <span style={{ ...text('caption'), color: colour.inkFainter }}>
                            It is the first thing anybody asks.
                          </span>
                        </label>
                      )}
                      <button onClick={() => setConfirmCancel(true)} disabled={confirmCancel}
                        style={{
                          width: '100%', padding: space.sm,
                          cursor: confirmCancel ? 'default' : 'pointer', ...text('bodyStrong'),
                          background: 'transparent',
                          color: confirmCancel ? colour.inkFainter : colour.warning,
                          border: `1px solid ${confirmCancel ? colour.line : colour.warningLine}`,
                          borderRadius: radius.control
                        }}>
                        {confirmCancel ? 'Confirm below ↓' : 'Call this case off'}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {!['moved', 'queued'].includes(status) && (
          <div style={{
            padding: `${space.sm}px ${space.md}px calc(${space.md}px + env(safe-area-inset-bottom, 0px))`,
            borderTop: `1px solid ${colour.line}`, display: 'flex', gap: space.sm, flexShrink: 0
          }}>
            {confirmCancel ? (
              <>
                <button onClick={() => { setConfirmCancel(false); setReason('') }}
                  style={{
                    flex: 1, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
                    background: 'transparent', color: colour.inkMuted,
                    border: `1px solid ${colour.line}`, borderRadius: radius.control
                  }}>Keep it on</button>
                <button onClick={() => setCancelled(true)} disabled={status === 'saving'}
                  style={{
                    flex: 2, padding: space.sm, ...text('bodyStrong'), color: 'white',
                    border: 'none', borderRadius: radius.control, background: colour.warning,
                    cursor: status === 'saving' ? 'default' : 'pointer'
                  }}>
                  {status === 'saving' ? 'Calling it off…' : 'Call the case off'}
                </button>
              </>
            ) : confirmDelete ? (
              <>
                <button onClick={() => setConfirmDelete(false)}
                  style={{
                    flex: 1, padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
                    background: 'transparent', color: colour.inkMuted,
                    border: `1px solid ${colour.line}`, borderRadius: radius.control
                  }}>Keep it</button>
                <button onClick={remove} disabled={status === 'saving'}
                  style={{
                    flex: 2, padding: space.sm, ...text('bodyStrong'), color: 'white',
                    border: 'none', borderRadius: radius.control, background: colour.danger,
                    cursor: status === 'saving' ? 'default' : 'pointer'
                  }}>
                  {status === 'saving' ? 'Deleting…' : 'Delete from the calendar'}
                </button>
              </>
            ) : (
              <>
            <button onClick={() => setConfirmDelete(true)} aria-label="Delete booking"
              style={{
                padding: space.sm, cursor: 'pointer', ...text('bodyStrong'),
                background: 'transparent', color: colour.danger,
                border: `1px solid ${colour.dangerLine}`, borderRadius: radius.control
              }}>Delete</button>
            {/* No "Cancel" here any more. The sheet has a Close in its
                header, and this row now sits under a button that calls off an
                operation — two controls saying cancel, one meaning "shut this
                sheet" and one meaning "call off the surgery", is a mistake
                waiting to happen. */}
            <button onClick={() => save()}
              disabled={!changed || status === 'saving' || status === 'loading'}
              style={{
                flex: 2, padding: space.sm, ...text('bodyStrong'), color: 'white', border: 'none',
                borderRadius: radius.control,
                background: (!changed || status === 'saving') ? colour.inkFainter : colour.accent,
                cursor: (!changed || status === 'saving') ? 'default' : 'pointer'
              }}>
              {status === 'saving' ? 'Saving…' : 'Save to calendar'}
            </button>
              </>
            )}
          </div>
          )}
        </div>
      </div>
    </Overlay>
    </>
  )
}
