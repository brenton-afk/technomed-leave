// ─── Plain-text / markdown rendition ─────────────────────────────────────────
// Built from the same WeekPlan as the view and the .docx, so the three can
// never disagree. Unlike the .docx this includes the weekend, because it mirrors
// what is on screen.

import { formatDayHeading, formatStamp } from './week.js'

export function planToText(plan, { includeWeekend = true } = {}) {
  const lines = []
  const days = includeWeekend ? plan.days : plan.days.slice(0, 5)

  lines.push(plan.title)
  lines.push(plan.subtitle)
  lines.push('')
  lines.push(plan.summaryLine)
  lines.push('')

  if (plan.surgeons.length) {
    lines.push(`Surgeons this week: ${plan.surgeons.join(', ')}`)
    lines.push('')
  }

  if (plan.notes) {
    lines.push('NOTES')
    lines.push(plan.notes)
    lines.push('')
  }

  for (const day of days) {
    lines.push(formatDayHeading(day.date).toUpperCase())
    lines.push(day.caseCountLine)

    for (const flag of day.flags) lines.push(`  ■ ${flag.text}`)

    for (const group of day.casesByHospital) {
      lines.push(`  ${group.hospital}`)
      for (const c of group.cases) {
        // Same four lines as the screen, and no time: theatre lists move too
        // often for one printed here to be right.
        // The operation leads the line where it is known, otherwise the system
        // does, so a case is never reduced to two names and a kit. The supply
        // rides on whichever line names the system.
        const supply = c.supply ? ` · ${c.supply}` : ''
        if (c.operation) {
          lines.push(`    ${c.patient} / ${c.surgeon} — ${c.operation}`)
          if (c.system) lines.push(`      System: ${c.system}${supply}`)
          else if (c.supply) lines.push(`      ${c.supply}`)
        } else {
          lines.push(`    ${c.patient} / ${c.surgeon}${c.system ? ` — ${c.system}${supply}` : ''}`)
          if (!c.system && c.supply) lines.push(`      ${c.supply}`)
        }
        if (c.kit) lines.push(`      Kit: ${c.kit}`)
        for (const note of c.notes) lines.push(`      ${note.text}`)
      }
    }

    for (const item of day.needsAttention || []) {
      lines.push(`  ■ NOT COUNTED: ${item.text} — ${item.reason}`)
    }
    for (const item of day.nonSurgeonItems) lines.push(`  ${item.text}`)
    if (day.otherRollup.length) {
      lines.push(`  Other: ${day.otherRollup.map(o => o.text).join(' · ')}`)
    }
    lines.push('')
  }

  if (plan.keyFlags.length) {
    lines.push('KEY FLAGS FOR THE WEEK')
    for (const flag of plan.keyFlags) lines.push(`  ${flag.label}: ${flag.text}`)
    lines.push('')
  }

  lines.push('Generated from bookings@technomed.com.au and Staff Leave calendar entries. '
    + 'Planning week runs Monday–Sunday: this document shows next week from Friday onward, '
    + 'and the current week on the Monday–Thursday syncs. '
    + `Last generated: ${formatStamp(plan.lastGeneratedAt)}`)

  return lines.join('\n')
}

export function dayToText(plan, dayDate) {
  const day = plan.days.find(d => d.date === dayDate)
  if (!day) return ''
  return planToText({ ...plan, days: [day], keyFlags: [] }, { includeWeekend: true })
}
