import React from 'react'
import { colour, text, space, radius } from '../../design/tokens.js'
import { brainlabService, brainlabLabel, RATES } from '../../clinicalPlan/brainlabBilling.js'
import { attendanceNotRequired } from '../../clinicalPlan/attendance.js'

// ─── Brainlab billing on a booking (Brent, 22 Nov 2026) ──────────────────────
// "It needs to be clearly discernible that these services were offered by
// TechnoMed so that information can be extracted easily at the time of
// generating the Brainlab invoice." One row on Edit booking: what the case is
// billed when we attend — AIRO $300, Navigation $250, or not billed — with the
// rules' suggestion shown, and a tap writing "Brainlab: …" on the booking,
// which then wins over the rules. Shown only where there is something to say:
// an RHH or Calvary case the rules bill, or one somebody has marked.

const CHOICES = [
  ['airo', `AIRO · $${RATES.airo}`, 'AIRO'],
  ['nav', `Navigation · $${RATES.nav}`, 'Navigation'],
  ['none', 'Not billed', 'Not billed']
]

export default function BrainlabBilling({ fields = {}, notes = '', reps = [], onChange }) {
  const said = brainlabLabel(fields.brainlab)
  const rules = brainlabService({ hospital: fields.hospital, procedure: fields.procedure, kit: fields.kit, notes })
  const where = String(fields.hospital || '').toUpperCase()
  const ourSite = /RHH|ROYAL|CLV|CALVARY|LENAH/.test(where)
  if (!said && !rules.kind && !(ourSite && /airo|curve|vario|brain\s*lab|navigat|stereotac/i.test(`${fields.procedure}\n${fields.kit}\n${notes}`))) return null

  const kind = said || rules.kind || 'none'
  const noF2F = attendanceNotRequired(notes)
  const status = kind === 'none' ? 'Not billed to Brainlab'
    : noF2F ? 'No F2F — tracked, not billed'
      : reps.length ? `Billed $${RATES[kind]} — ${reps.join(' / ')} attended`
        : `Billed $${RATES[kind]} once a rep is marked as attended`

  const chip = on => ({
    padding: `7px ${space.md}px`, borderRadius: radius.pill, cursor: 'pointer', ...text('caption'),
    fontWeight: on ? 700 : 500,
    background: on ? colour.accent : colour.surface,
    color: on ? 'white' : colour.inkMuted,
    border: `1px solid ${on ? colour.accent : colour.line}`
  })

  return (
    <div data-brainlab-billing style={{
      marginBottom: space.md, padding: `${space.sm}px ${space.md}px`,
      borderRadius: radius.control, background: colour.surface, border: `1px solid ${colour.line}`
    }}>
      <div style={{ ...text('micro'), textTransform: 'uppercase', color: colour.inkFaint, marginBottom: 6 }}>Brainlab</div>
      <div role="group" aria-label="Brainlab billing" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {CHOICES.map(([k, label, line]) => (
          <button key={k} type="button" aria-pressed={kind === k} data-brainlab-choice={k}
            onClick={() => onChange(said === k ? '' : line)} style={chip(kind === k)}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ ...text('caption'), color: colour.inkMuted }} data-brainlab-status>
        {status}{said ? ' · set on this booking' : rules.kind ? ` · suggested: ${rules.why.toLowerCase()}` : ''}
      </div>
    </div>
  )
}
