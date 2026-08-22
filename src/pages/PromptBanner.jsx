import React, { useState, useEffect, useMemo } from 'react'
import { colour, text, space, radius } from '../design/tokens.js'
import { IconAlert, IconChevron } from '../design/icons.jsx'
import { currentPeriod, isPeriodClosed } from '../../api/_fortnight.js'

// ─── Prompts ──────────────────────────────────────────────────────────────────
// What the Today feed was actually for. Everything else on it duplicated the
// case plan, so only this survives: one slim line when something needs you,
// nothing at all when it does not. Deliberately not a second feed.

export default function PromptBanner({ user, onNavigate }) {
  const [prompts, setPrompts] = useState([])
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])

  useEffect(() => {
    let cancelled = false
    const found = []

    async function load() {
      if (user?.staff?.hasTimesheets) {
        try {
          const res = await fetch('/api/timesheet/agent?action=mine', { headers: authHeaders })
          const data = await res.json()
          const period = currentPeriod()
          const records = data.records || []
          const rejected = records.find(r => r.periodStart === period.start && r.status === 'rejected')
          const submitted = records.some(r => r.periodStart === period.start && r.status !== 'rejected')

          if (rejected) {
            found.push({
              id: 'ts-rejected', tone: 'danger',
              text: `Timesheet returned — ${rejected.rejectionReason}`,
              go: { tab: 'me', sub: 'timesheets' }
            })
          } else if (!submitted) {
            found.push({
              id: 'ts-due',
              tone: isPeriodClosed(period.start) ? 'danger' : 'warning',
              text: isPeriodClosed(period.start)
                ? `Timesheet overdue — ${period.start} to ${period.end}`
                : 'Timesheet due Sunday',
              go: { tab: 'me', sub: 'timesheets' }
            })
          }
        } catch { /* a prompt is never worth an error state */ }
      }

      try {
        const res = await fetch('/api/meetings/agent?action=worklist', { headers: authHeaders })
        const data = await res.json()
        const mine = (data.items || []).filter(i =>
          i.status !== 'done' && (!i.assignee || i.assignee === user?.name))
        if (mine.length) {
          found.push({
            id: 'actions', tone: 'info',
            text: `${mine.length} action${mine.length === 1 ? '' : 's'} assigned to you`,
            go: { tab: 'kit', sub: 'projects' }
          })
        }
      } catch { /* same */ }

      if (!cancelled) setPrompts(found)
    }

    load()
    return () => { cancelled = true }
  }, [authHeaders, user])

  if (prompts.length === 0) return null

  const tones = {
    info: { bg: colour.accentSoft, fg: colour.accentDeep, line: 'rgba(24,154,133,0.28)' },
    warning: { bg: colour.warningSoft, fg: colour.warning, line: colour.warningLine },
    danger: { bg: colour.dangerSoft, fg: colour.danger, line: colour.dangerLine }
  }

  return (
    <div style={{ padding: `${space.md}px ${space.lg}px 0` }}>
      {prompts.map(prompt => {
        const t = tones[prompt.tone] || tones.info
        return (
          <button key={prompt.id} onClick={() => onNavigate(prompt.go)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: space.sm,
              background: t.bg, border: `1px solid ${t.line}`, color: t.fg,
              borderRadius: radius.control, padding: `${space.sm + 2}px ${space.md}px`,
              marginBottom: space.sm, cursor: 'pointer', textAlign: 'left', font: 'inherit'
            }}>
            <span style={{ display: 'flex', flexShrink: 0 }}><IconAlert size={15} /></span>
            <span style={{ ...text('caption'), flex: 1, minWidth: 0 }}>{prompt.text}</span>
            <span style={{ display: 'flex', flexShrink: 0, opacity: 0.6 }}><IconChevron size={15} /></span>
          </button>
        )
      })}
    </div>
  )
}
