import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Header, Page, Banner } from '../design/Shell.jsx'
import { colour, text, space, radius } from '../design/tokens.js'
import { useLiveRefresh } from '../liveRefresh.js'
import { GUIDE, RUNSHEET_TAB, RUNSHEET_ITEMS } from '../teamLeader/guide.js'

// ─── Clinical Team Leader ─────────────────────────────────────────────────────
// The duty leader's field guide, brought in from the "TM Team Leader" artifact.
//
// The content lives in src/teamLeader/guide.js as data; this file is only how it
// is drawn. That split is what lets the guide be re-synced from the artifact —
// which is co-written and still being edited — without touching any rendering.
//
// The run-sheet is shared. The role runs on a weekly duty rotation, and the
// point of publishing the day's duties is that the team can see they are done,
// so a tick carries who made it and everyone's screen shows the same state.
// Everything else on these tabs is reference, and reference is read-only.

const TONES = {
  default: { bg: colour.canvas, line: colour.line, ink: colour.inkMuted },
  ' blue': { bg: colour.accentSoft, line: 'rgba(24,154,133,0.28)', ink: colour.accentDeep },
  ' amber': { bg: colour.warningSoft, line: colour.warningLine, ink: colour.warning }
}

/** Inline emphasis. Runs, never HTML — see the note in guide.js. */
function Runs({ runs, style }) {
  return (
    <span style={style}>
      {(runs || []).map((run, i) =>
        run.b
          ? <strong key={i} style={{ fontWeight: 700, color: 'inherit' }}>{run.t}</strong>
          : <React.Fragment key={i}>{run.t}</React.Fragment>)}
    </span>
  )
}

function Tile({ block }) {
  return (
    <div style={{ display: 'flex', gap: space.sm, padding: `${space.sm}px 0` }}>
      <div aria-hidden="true" style={{ ...text('heading'), width: 24, flexShrink: 0 }}>{block.icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...text('bodyStrong'), color: colour.ink }}>{block.title}</div>
        {block.detail && (
          <div style={{ ...text('caption'), color: colour.inkFaint }}>{block.detail}</div>
        )}
      </div>
    </div>
  )
}

function Step({ block }) {
  return (
    <div style={{ display: 'flex', gap: space.sm, padding: `${space.sm}px 0` }}>
      <div aria-hidden="true" style={{
        width: 22, height: 22, borderRadius: radius.pill, flexShrink: 0,
        background: colour.accentSoft, color: colour.accentDeep,
        display: 'flex', alignItems: 'center', justifyContent: 'center', ...text('micro')
      }}>
        {block.num}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...text('bodyStrong'), color: colour.ink }}>{block.title}</div>
        {block.detail && (
          <div style={{ ...text('caption'), color: colour.inkFaint }}>{block.detail}</div>
        )}
      </div>
    </div>
  )
}

function GroupRow({ block }) {
  return (
    <div style={{
      padding: `${space.sm}px ${space.md}px`, marginBottom: space.sm,
      borderRadius: radius.control, background: colour.surface,
      // The inflow groups are the ones the duty leader must be in, so they carry
      // a little more weight than the ones that are only context.
      border: `1px solid ${block.key ? colour.line : colour.lineSoft}`
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
        <span style={{ ...text('bodyStrong'), color: colour.ink }}>{block.name}</span>
        {block.tag && (
          <span style={{
            ...text('micro'), textTransform: 'uppercase', borderRadius: radius.pill,
            padding: '2px 7px', flexShrink: 0,
            background: block.tagKind === 'ext' ? colour.warningSoft : colour.accentSoft,
            color: block.tagKind === 'ext' ? colour.warning : colour.accentDeep
          }}>
            {block.tag}
          </span>
        )}
      </div>
      <Runs runs={block.runs} style={{ ...text('caption'), color: colour.inkFaint }} />
    </div>
  )
}

function Matrix({ block }) {
  const ink = kind => kind === 'yes' ? colour.accentDeep
    : kind === 'no' ? colour.danger
      : kind === 'part' ? colour.warning : colour.inkFaint
  return (
    // Its own scroller, so a five-column table cannot make the page scroll
    // sideways on a phone.
    <div style={{ overflowX: 'auto', margin: `${space.sm}px 0` }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 300 }}>
        <thead>
          <tr>
            {block.head.map(h => (
              <th key={h} style={{
                ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
                textAlign: 'left', padding: `${space.xs}px ${space.sm}px`,
                borderBottom: `1px solid ${colour.line}`, whiteSpace: 'nowrap'
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} style={{
                  ...text(j === 0 ? 'bodyStrong' : 'caption'),
                  color: j === 0 ? colour.ink : ink(cell.kind),
                  padding: `${space.xs}px ${space.sm}px`,
                  borderBottom: `1px solid ${colour.lineSoft}`, whiteSpace: 'nowrap'
                }}>{cell.text}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A run-sheet item.
 *
 * Optimistic: the tick lands the moment it is tapped and rolls back if the
 * server refuses. A checklist that pauses on a round trip in a hospital corridor
 * gets tapped twice.
 */
function Check({ block, tick, state, shared }) {
  const done = Boolean(state)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      onClick={() => tick(block.id, !done)}
      style={{
        display: 'flex', gap: space.sm, width: '100%', textAlign: 'left',
        alignItems: 'flex-start', padding: `${space.sm}px ${space.sm}px`,
        marginBottom: 6, borderRadius: radius.control, cursor: 'pointer',
        background: done ? colour.accentSoft : colour.surface,
        border: `1px solid ${done ? 'rgba(24,154,133,0.28)' : colour.line}`
      }}>
      <span aria-hidden="true" style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? colour.accent : 'transparent',
        border: `1.5px solid ${done ? colour.accent : colour.inkFainter}`,
        ...text('caption'), color: 'white', fontWeight: 700
      }}>
        {done ? '✓' : ''}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{
          ...text('bodyStrong'), display: 'block',
          color: done ? colour.inkMuted : colour.ink
        }}>
          {block.title}
        </span>
        {block.detail && (
          <span style={{ ...text('caption'), display: 'block', color: colour.inkFaint }}>
            {block.detail}
          </span>
        )}
        {/* Who did it, which is the reason the run-sheet is shared at all. */}
        {shared && done && state.by && (
          <span style={{ ...text('caption'), display: 'block', color: colour.accentDeep }}>
            {state.by}{state.at ? ` · ${clock(state.at)}` : ''}
          </span>
        )}
      </span>
    </button>
  )
}

function clock(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-AU', {
      timeZone: 'Australia/Hobart', hour: 'numeric', minute: '2-digit', hour12: true
    }).toLowerCase().replace(/\s+/g, '')
  } catch {
    return ''
  }
}

function Block({ block, tick, ticks, shared }) {
  switch (block.type) {
    case 'pill':
      return (
        <div style={{
          ...text('micro'), textTransform: 'uppercase', color: colour.accentDeep,
          background: colour.accentSoft, borderRadius: radius.pill,
          padding: '3px 9px', display: 'inline-block', marginBottom: space.sm
        }}>{block.text}</div>
      )
    case 'heading':
      return <h2 style={{ ...text('title'), color: colour.ink, margin: `0 0 ${space.sm}px` }}>{block.text}</h2>
    case 'subheading':
      return <h3 style={{ ...text('heading'), color: colour.ink, margin: `${space.lg}px 0 ${space.xs}px` }}>{block.text}</h3>
    case 'lead':
      return <Runs runs={block.runs} style={{ ...text('body'), color: colour.inkMuted, display: 'block', marginBottom: space.md }} />
    case 'para':
      return <Runs runs={block.runs} style={{ ...text('body'), color: colour.inkMuted, display: 'block', marginBottom: space.sm }} />
    case 'note':
      return <Runs runs={block.runs} style={{ ...text('caption'), color: colour.inkFaint, display: 'block', marginTop: space.xs }} />
    case 'hint':
      return <div style={{ ...text('caption'), color: colour.inkFaint, marginBottom: space.sm }}>{block.text}</div>
    case 'divider':
      return (
        <div style={{
          ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint,
          margin: `${space.lg}px 0 ${space.sm}px`, paddingTop: space.sm,
          borderTop: `1px solid ${colour.line}`
        }}>{block.text}</div>
      )
    case 'group':
      // The time of day a run of items belongs to: the morning sweep, the
      // evening sweep. Sets the rhythm of the day, so it reads as a heading.
      return (
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: space.sm,
          margin: `${space.lg}px 0 ${space.sm}px`
        }}>
          <span aria-hidden="true" style={text('heading')}>{block.icon}</span>
          <span style={{ ...text('heading'), color: colour.ink }}>{block.title}</span>
          {block.note && (
            <span style={{ ...text('caption'), color: colour.accentDeep, marginLeft: 'auto' }}>
              {block.note}
            </span>
          )}
        </div>
      )
    case 'check':
      return <Check block={block} tick={tick} state={ticks[block.id]} shared={shared} />
    case 'step': return <Step block={block} />
    case 'tile': return <Tile block={block} />
    case 'group-row': return <GroupRow block={block} />
    case 'table': return <Matrix block={block} />
    case 'list':
      return (
        <ul style={{ margin: `0 0 ${space.sm}px`, paddingLeft: 18 }}>
          {block.items.map((runs, i) => (
            <li key={i} style={{ marginBottom: space.xs }}>
              <Runs runs={runs} style={{ ...text('body'), color: colour.inkMuted }} />
            </li>
          ))}
        </ul>
      )
    case 'callout': {
      const tone = TONES[block.tone] || TONES.default
      return (
        <div style={{
          background: tone.bg, border: `1px solid ${tone.line}`, color: tone.ink,
          borderRadius: radius.control, padding: `${space.sm}px ${space.md}px`,
          margin: `${space.sm}px 0 ${space.md}px`
        }}>
          <Runs runs={block.runs} style={text('caption')} />
        </div>
      )
    }
    default:
      return null
  }
}

export default function TeamLeader({ user, switcher }) {
  const [tabId, setTabId] = useState(GUIDE[0].id)
  const [ticks, setTicks] = useState({})
  // The New Booking tab has a checklist too, but it is a definition of done for
  // *one booking* rather than a duty for the day — several bookings can run
  // through it before lunch. Sharing it, or keeping it overnight, would both be
  // wrong, so it is scratch state that clears when the screen closes.
  const [scratch, setScratch] = useState({})
  const [error, setError] = useState('')
  // Ticks made here that the server has not confirmed. Without this a poll
  // landing mid-tap would overwrite what was just tapped with the older state.
  const pending = useRef(new Set())

  const tab = GUIDE.find(t => t.id === tabId) || GUIDE[0]
  const isRunsheet = tab.id === RUNSHEET_TAB

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/calendar/today?action=runsheet', {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTicks(current => {
        const merged = { ...data.ticks }
        for (const id of pending.current) {
          if (current[id]) merged[id] = current[id]
          else delete merged[id]
        }
        return merged
      })
      setError('')
    } catch {
      // A failed poll leaves the run-sheet alone. Blanking the day's ticks
      // because the wifi dropped would read as the work being undone.
    }
  }, [user?.token])

  useEffect(() => { load() }, [load])
  useLiveRefresh(useCallback(() => { load() }, [load]), [load])

  const tick = useCallback(async (itemId, done) => {
    pending.current.add(itemId)
    const previous = ticks[itemId]
    // Optimistic: a checklist that pauses on a round trip gets tapped twice.
    setTicks(c => {
      const next = { ...c }
      if (done) next[itemId] = { by: user?.staff?.firstName || 'You', at: new Date().toISOString() }
      else delete next[itemId]
      return next
    })
    try {
      const res = await fetch('/api/calendar/today?action=runsheet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {})
        },
        body: JSON.stringify({ itemId, done })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      pending.current.delete(itemId)
      setTicks(data.ticks || {})
      setError('')
    } catch (err) {
      // Put it back. A tick that looks saved and is not is worse than one that
      // visibly failed — the next person reads it as the job being done.
      pending.current.delete(itemId)
      setTicks(c => {
        const next = { ...c }
        if (previous) next[itemId] = previous
        else delete next[itemId]
        return next
      })
      setError(`That did not save (${err.message}). Tap it again.`)
    }
  }, [ticks, user])

  const scratchTick = useCallback((itemId, done) => {
    setScratch(c => ({ ...c, [itemId]: done ? { by: '' } : undefined }))
  }, [])

  const doneCount = RUNSHEET_ITEMS.filter(id => ticks[id]).length

  return (
    <Page style={{ display: 'flex', flexDirection: 'column' }}>
      <Header eyebrow="This week" title="Team leader" subtitle="The duty leader's daily playbook">
        {switcher}
        {/* Eight tabs will not fit across a phone, so the strip scrolls rather
            than wrapping into two rows that shift as the selection moves. */}
        <div role="tablist" aria-label="Guide section" style={{
          display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2,
          scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch'
        }}>
          {GUIDE.map(t => {
            const on = t.id === tab.id
            return (
              <button key={t.id} role="tab" aria-selected={on} onClick={() => setTabId(t.id)}
                style={{
                  ...text('caption'), fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                  padding: '6px 12px', borderRadius: radius.pill, cursor: 'pointer',
                  border: 'none',
                  background: on ? 'white' : 'rgba(255,255,255,0.12)',
                  color: on ? colour.navy : 'rgba(255,255,255,0.8)'
                }}>
                {t.label}
                {t.id === RUNSHEET_TAB && doneCount > 0 && ` · ${doneCount}/${RUNSHEET_ITEMS.length}`}
              </button>
            )
          })}
        </div>
      </Header>

      <div style={{ flex: 1, padding: `${space.md}px ${space.md}px 100px`, overflowY: 'auto' }}>
        {error && <Banner tone="danger">{error}</Banner>}

        {isRunsheet && (
          <Banner tone={doneCount === RUNSHEET_ITEMS.length ? 'info' : 'warning'}>
            {doneCount === RUNSHEET_ITEMS.length
              ? <><strong>The day is done.</strong> All {RUNSHEET_ITEMS.length} run-sheet items ticked.</>
              : <><strong>{doneCount} of {RUNSHEET_ITEMS.length} done today.</strong> Everyone sees this — it resets overnight.</>}
          </Banner>
        )}

        {tab.blocks.map((block, i) => (
          <Block key={i} block={block} shared={isRunsheet}
            tick={isRunsheet ? tick : scratchTick}
            ticks={isRunsheet ? ticks : scratch} />
        ))}
      </div>
    </Page>
  )
}
