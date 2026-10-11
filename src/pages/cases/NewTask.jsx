import React, { useState } from 'react'
import { Overlay } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { STAFF } from '../../staffConfig.js'
import {
  TASK_KINDS, TASK_PLACES, taskThings, kindFor, taskSummary
} from '../../clinicalPlan/tasks.js'
import {
  weekdayName, addCivilDays, parseDateStr, toDateStr, todayStr
} from '../../clinicalPlan/week.js'

// Short months, because a chip is a chip. week.js keeps the long names to
// itself and CaseWeek keeps its own copy; three letters is all this needs.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayNum = day => parseDateStr(day).day
const monthOf = day => MONTHS_SHORT[parseDateStr(day).month - 1]
const shiftDay = (day, by) => toDateStr(addCivilDays(parseDateStr(day), by))

// ─── Adding a job to a day ───────────────────────────────────────────────────
// "These reminders are important and need to be really easy to add to the day
// so everyone can see them. It needs to be easier than adding a task in Google
// Calendar, which is a bit clunky and relies on a lot of text entry."
//
// So this is a form with no text in it. Every value is a tap on something the
// app already knows: our own kits, our own two hospitals and the office, our
// own staff, and the next few days. Four taps makes "Move the Mariner from RHH
// to Calvary on Tuesday" — kind, kit, from, to — and the date is already right
// because the button was pressed on a day.
//
// The free-text box is for the task nobody anticipated. It is the last thing on
// the form rather than the shape of it, and it is the difference between a tool
// somebody uses in a corridor and one they mean to use later.
//
// The sentence that will go on the calendar is shown as it is built, so nobody
// has to save it to find out what it says.

/** A row of taps. The whole interface, really. */
function Chips({ options, value, onChange, label, allowEmpty }) {
  return (
    <div style={{ marginBottom: space.md }}>
      <span style={{
        ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
        display: 'block', marginBottom: 6
      }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(option => {
          const id = typeof option === 'string' ? option : option.key
          const name = typeof option === 'string' ? option : option.label
          const on = value === id
          return (
            <button key={id} type="button"
              aria-pressed={on}
              onClick={() => onChange(on && allowEmpty ? '' : id)}
              style={{
                minHeight: 40, padding: `0 ${space.md}px`, cursor: 'pointer',
                borderRadius: radius.pill,
                border: `1px solid ${on ? colour.accent : colour.line}`,
                background: on ? colour.accentSoft : colour.surface,
                color: on ? colour.accentDeep : colour.inkMuted,
                ...text('caption'), fontWeight: on ? 700 : 400
              }}>{name}</button>
          )
        })}
      </div>
    </div>
  )
}

/** Today, tomorrow, and the rest of the week. Nobody types a date. */
function dayChoices(from) {
  const start = from || todayStr()
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i))
}

export default function NewTask({ user, date: openOn, onClose, onCreated }) {
  const [date, setDate] = useState(() => openOn || todayStr())
  const [kind, setKind] = useState('')
  const [thing, setThing] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [who, setWho] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState('ready')
  const [error, setError] = useState('')

  const entry = kindFor(kind)
  const preview = entry ? taskSummary({ kind, thing, from, to }) : ''
  // The only thing that must be there. A kind with nothing to act on is not a
  // task anybody can do, and "Something else" carries its own words.
  const ready = Boolean(entry && thing.trim())

  const save = async () => {
    if (!ready || status === 'saving') return
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/calendar/today?action=task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token}` },
        body: JSON.stringify({ date, kind, thing, from, to, who, note })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not add the task')
      onCreated?.(data.event)
      onClose?.()
    } catch (err) {
      setStatus('ready')
      setError(err.message)
    }
  }

  return (
    <Overlay>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(4,39,70,0.45)', zIndex: 3000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
      }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Add a task"
          className="tm-sheet"
          style={{
            background: colour.canvas, width: '100%', maxWidth: 460,
            borderRadius: `${radius.sheet}px ${radius.sheet}px 0 0`,
            display: 'flex', flexDirection: 'column'
          }}>

          <div style={{
            padding: `${space.md}px ${space.md}px ${space.sm}px`,
            borderBottom: `1px solid ${colour.line}`, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: space.sm
          }}>
            <span style={{ ...text('heading'), color: colour.ink, flex: 1 }}>Add a task</span>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'none', border: 'none', cursor: 'pointer',
              ...text('heading'), color: colour.inkFaint, lineHeight: 1
            }}>×</button>
          </div>

          {/* Up, never sideways. A sheet that pans horizontally is the bug
              that had the edit window sliding under a thumb. */}
          <div style={{ padding: space.md, overflowY: 'auto', overflowX: 'hidden' }}>
            <Chips label="What needs doing" options={TASK_KINDS}
              value={kind} onChange={setKind} />

            {entry && (
              <>
                {entry.needsThing ? (
                  <Chips label="Which kit" options={taskThings()}
                    value={thing} onChange={setThing} allowEmpty />
                ) : null}

                {/* The one place typing is expected — and for the three kinds
                    that are not "something else", only when the kit wanted is
                    not one of ours. */}
                <label style={{ display: 'block', marginBottom: space.md }}>
                  <span style={{
                    ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
                    display: 'block', marginBottom: 4
                  }}>{entry.needsThing ? 'Or type it' : 'What is it'}</span>
                  <input value={thing} onChange={e => setThing(e.target.value)}
                    placeholder={entry.needsThing ? 'Something not on the list' : 'Ring Device Tech about Friday'}
                    style={{
                      width: '100%', padding: `${space.sm}px ${space.md}px`, boxSizing: 'border-box',
                      border: `1px solid ${colour.line}`, borderRadius: radius.control,
                      ...text('field'), color: colour.ink, background: colour.surface, outline: 'none'
                    }} />
                </label>

                {entry.places >= 1 && (
                  <Chips label={entry.places === 2 ? 'From' : 'Where'}
                    options={TASK_PLACES} value={from} onChange={setFrom} allowEmpty />
                )}
                {entry.places === 2 && (
                  <Chips label="To" options={TASK_PLACES}
                    value={to} onChange={setTo} allowEmpty />
                )}
              </>
            )}

            <Chips label="Which day"
              options={dayChoices(openOn).map(d => ({
                key: d, label: `${weekdayName(d).slice(0, 3)} ${dayNum(d)} ${monthOf(d)}`
              }))}
              value={date} onChange={setDate} />

            {/* Nobody by default, which is the whole team. One tap puts a name
                on it when it is a particular person's job. */}
            <Chips label="For (optional — anyone, if you leave it)"
              options={STAFF.map(s => s.firstName)}
              value={who} onChange={setWho} allowEmpty />

            {preview && (
              <div style={{
                padding: space.sm, borderRadius: radius.control,
                background: colour.surface, border: `1px solid ${colour.line}`,
                marginBottom: space.md
              }}>
                <span style={{
                  ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
                  display: 'block', marginBottom: 2
                }}>On the calendar</span>
                <span style={{ ...text('body'), color: colour.ink }}>{preview}</span>
              </div>
            )}

            {error && (
              <div role="alert" style={{
                ...text('caption'), color: colour.warning, marginBottom: space.sm
              }}>{error}</div>
            )}

            <button onClick={save} disabled={!ready || status === 'saving'}
              style={{
                width: '100%', minHeight: 48, cursor: ready ? 'pointer' : 'default',
                borderRadius: radius.control, border: 'none',
                background: ready ? colour.accent : colour.line,
                color: ready ? 'white' : colour.inkFaint,
                ...text('bodyStrong')
              }}>
              {status === 'saving' ? 'Adding…' : 'Add the task'}
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  )
}
