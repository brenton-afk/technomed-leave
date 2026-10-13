import { colour } from '../../design/tokens.js'

// ─── The bits every project screen needs ─────────────────────────────────────

/**
 * A colour per project, so a board is recognisable before it is read.
 *
 * Six, not a picker. The point of the colour is that "the teal one" means
 * something to everybody in the room, and a free colour picker produces nine
 * shades of blue and no shared language. The same reasoning as the surgeon
 * colours, and these are deliberately nothing like those — a project is not a
 * surgeon and the two lists appear on the same phone.
 */
export const PROJECT_TINTS = {
  teal: { solid: '#189a85', wash: '#e8f4f2', ink: '#0b4f45' },
  navy: { solid: '#2c5f8d', wash: '#e9f0f7', ink: '#1a3d5c' },
  plum: { solid: '#7d4a7e', wash: '#f4ecf4', ink: '#4d2d4e' },
  clay: { solid: '#b0603a', wash: '#f9eee8', ink: '#6d3a22' },
  moss: { solid: '#5c7a3f', wash: '#eef3e8', ink: '#3a4e28' },
  slate: { solid: '#5a6673', wash: '#eef0f3', ink: '#39414a' }
}

export const tintOf = name => PROJECT_TINTS[name] || PROJECT_TINTS.teal

export const PRIORITY_COLOURS = {
  urgent: colour.danger,
  normal: '#1a7a6e',
  low: colour.inkFainter
}

export const PRIORITY_LABELS = { urgent: 'Urgent', normal: 'Normal', low: 'Low' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "13 Oct 2026", or an em dash where there is no date. */
export function formatDate(d) {
  if (!d) return '—'
  const [y, m, day] = String(d).split('-')
  if (!y || !m || !day) return String(d)
  return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`
}

/** "13 Oct", for anywhere the year is obvious from context. */
export function formatShort(d) {
  if (!d) return ''
  const [, m, day] = String(d).split('-')
  if (!m || !day) return String(d)
  return `${parseInt(day, 10)} ${MONTHS[parseInt(m, 10) - 1]}`
}

/**
 * How a due date should read, and how alarmed it should look.
 *
 * Overdue is named rather than just coloured. "3 days late" is a fact somebody
 * acts on; red text is a decoration people stop seeing after a fortnight.
 */
export function dueState(due, today) {
  if (!due) return null
  if (!today) return { label: formatShort(due), tone: 'calm' }
  if (due < today) {
    const days = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000)
    return {
      label: days === 1 ? '1 day late' : `${days} days late`,
      tone: 'late'
    }
  }
  if (due === today) return { label: 'Due today', tone: 'now' }
  return { label: formatShort(due), tone: 'calm' }
}

export const DUE_TONES = {
  late: { colour: colour.danger, background: colour.dangerSoft },
  now: { colour: colour.warning, background: colour.warningSoft },
  calm: { colour: colour.inkFaint, background: 'transparent' }
}

/** Today in Hobart, as the date strings everywhere else use. */
export function todayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Hobart', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now)
  const at = t => parts.find(p => p.type === t)?.value
  return `${at('year')}-${at('month')}-${at('day')}`
}

/** "2 updates", or nothing at all when there are none. */
export function updatesLabel(n) {
  if (!n) return ''
  return n === 1 ? '1 update' : `${n} updates`
}
