// ─── My leave (Toni, 26 Nov 2026) ─────────────────────────────────────────────
// Your leave from today on, requested and approved, in one list: the portal's
// own requests and every Staff Leave calendar entry naming you (what Toni
// entered before leave went through the portal). Read-only; the rules are in
// src/leave/myLeave.js, the reading in api/calendar/today.js?action=myleave.

import React, { useCallback, useEffect, useState } from 'react'
import { Page, Header, Body, Card, Banner, Button, EmptyState, Skeleton, SectionLabel } from '../../design/Shell.jsx'
import { colour, text, space, radius } from '../../design/tokens.js'
import { IconLeave } from '../../design/icons.jsx'
import { parseDateStr } from '../../clinicalPlan/week.js'
import { weekdaysIn } from '../../leave/myLeave.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Mon 8 Dec" — from a 'YYYY-MM-DD', no device timezone involved. */
export function shortDay(day) {
  const c = parseDateStr(day)
  const wd = new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay()
  return `${DAYS[wd]} ${c.day} ${MONTHS[c.month - 1]}`
}

export function spanWords(item) {
  if (item.from === item.to) return shortDay(item.from)
  return `${shortDay(item.from)} – ${shortDay(item.to)}`
}

function lengthWords(item) {
  if (item.hours) return `${item.hours}h`
  const n = weekdaysIn(item.from, item.to)
  if (!n) return ''
  return `${n} working day${n === 1 ? '' : 's'}`
}

function untilWords(item, today) {
  if (item.from <= today) return item.to === today ? 'Today' : 'On now'
  const a = parseDateStr(today), b = parseDateStr(item.from)
  const days = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000)
  if (days === 1) return 'Tomorrow'
  if (days < 14) return `In ${days} days`
  if (days < 60) return `In ${Math.round(days / 7)} weeks`
  return `In ${Math.round(days / 30)} months`
}

const STATUS = {
  approved: { word: 'Approved', bg: colour.accentSoft, fg: colour.accentDeep },
  pending: { word: 'Waiting for approval', bg: colour.warningSoft, fg: colour.warning }
}

function LeaveRow({ item, today }) {
  const s = STATUS[item.status] || STATUS.approved
  const length = lengthWords(item)
  return (
    <Card style={{ display: 'flex', gap: space.md, alignItems: 'flex-start' }}>
      <div data-my-leave-row={item.id} style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...text('bodyStrong'), color: colour.ink }}>{spanWords(item)}</div>
        <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: 2 }}>
          {[item.label, length, item.note, item.back ? `back ${shortDay(item.back)}` : ''].filter(Boolean).join(' · ')}
        </div>
        <div style={{ ...text('micro'), color: colour.inkFainter, marginTop: 4 }}>
          {item.source === 'calendar' ? 'From the Staff Leave calendar' : 'Requested in the portal'}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flex: 'none' }}>
        <span data-my-leave-status={item.status} style={{ ...text('micro'), fontWeight: 700, background: s.bg, color: s.fg, borderRadius: radius.pill, padding: '3px 8px', whiteSpace: 'nowrap' }}>{s.word}</span>
        <span style={{ ...text('micro'), color: colour.inkFaint, whiteSpace: 'nowrap' }}>{untilWords(item, today)}</span>
      </div>
    </Card>
  )
}

export default function MyLeave({ user, onBack, onApply }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch('/api/calendar/today?action=myleave', {
        headers: user?.token ? { Authorization: `Bearer ${user.token}` } : {}
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || 'Your leave could not be loaded.')
      setData(body)
    } catch (err) {
      setError(err.message || 'Your leave could not be loaded.')
    }
  }, [user?.token])

  useEffect(() => { load() }, [load])

  const leave = data?.leave || []
  const pending = leave.filter(l => l.status === 'pending')
  const approved = leave.filter(l => l.status !== 'pending')

  return (
    <Page>
      <Header eyebrow="Pay and time" title="My leave" subtitle="Coming up — requested and approved" onBack={onBack} />
      <Body>
        {error && <Banner tone="danger" action={<Button variant="secondary" onClick={load}>Try again</Button>}>{error}</Banner>}
        {data?.calendarError && <Banner tone="warning">{data.calendarError} Leave entered there is missing below.</Banner>}
        {data?.portalError && <Banner tone="warning">{data.portalError}</Banner>}

        {!data && !error && (
          <div data-my-leave-loading>
            {[0, 1, 2].map(i => <Card key={i}><Skeleton width="50%" height={14} /><Skeleton width="70%" style={{ marginTop: 8 }} /></Card>)}
          </div>
        )}

        {data && !leave.length && (
          <EmptyState icon={IconLeave} title="No leave coming up"
            detail="Nothing requested in the portal and nothing on the Staff Leave calendar under your name." />
        )}

        {pending.length > 0 && (
          <>
            <SectionLabel>Waiting for approval · {pending.length}</SectionLabel>
            {pending.map(item => <LeaveRow key={item.id} item={item} today={data.today} />)}
          </>
        )}
        {approved.length > 0 && (
          <>
            <SectionLabel>Approved · {approved.length}</SectionLabel>
            {approved.map(item => <LeaveRow key={item.id} item={item} today={data.today} />)}
          </>
        )}

        {onApply && (
          <div style={{ marginTop: space.lg }}>
            <Button onClick={onApply}>Apply for leave</Button>
          </div>
        )}
        <div style={{ ...text('caption'), color: colour.inkFaint, marginTop: space.md, lineHeight: 1.5 }}>
          Leave Toni entered on the Staff Leave calendar shows here as approved. Something missing or wrong? Tell Toni — the calendar is where it is kept.
        </div>
      </Body>
    </Page>
  )
}

