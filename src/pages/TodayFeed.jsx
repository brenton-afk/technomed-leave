import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Page, Header, Body, Card, Banner, SectionLabel, Button, Skeleton } from '../design/Shell.jsx'
import { colour, text, space, radius, card } from '../design/tokens.js'
import {
  IconScan, IconClock, IconAlert, IconCheck, IconTasks, IconCalendar, IconChevron
} from '../design/icons.jsx'
import { accentFor, accentTextFor } from '../clinicalPlan/theme.js'
import { todayStr, formatTimeRange, formatDayHeading, weekWindowFor } from '../clinicalPlan/week.js'
import { fetchWeekPlan } from '../clinicalPlan/provider.js'
import { currentPeriod, isPeriodClosed } from '../../api/_fortnight.js'

// ─── Today ────────────────────────────────────────────────────────────────────
// A feed rather than a dashboard of tiles. The point is that on most days nobody
// should have to navigate: what is on, what needs doing, and the one action they
// are most likely to want are all in one scroll. Everything here is a pointer
// into a section, never a place to do work.

const GREETINGS = [
  [5, 'Good morning'], [12, 'Good afternoon'], [17, 'Good evening'], [24, 'Good evening']
]

function greeting(hour) {
  for (const [until, word] of GREETINGS) if (hour < until) return word
  return 'Hello'
}

export default function TodayFeed({ user, onNavigate }) {
  const today = todayStr()
  const [plan, setPlan] = useState(null)
  const [planState, setPlanState] = useState('loading')
  const [worklist, setWorklist] = useState([])
  const [timesheet, setTimesheet] = useState(null)

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${user?.token || ''}` }), [user])
  const firstName = user?.name?.split(' ')[0] || ''
  const hour = new Date().getHours()

  const load = useCallback(async () => {
    // The plan window for *today*, which is not always the default week — on a
    // Friday the plan view jumps to next week, but the feed is about now.
    const window_ = weekWindowFor(today)
    try {
      const result = await fetchWeekPlan(window_, { token: user?.token })
      setPlan(result.plan)
      setPlanState('ready')
    } catch {
      setPlanState('error')
    }

    // Both are best-effort: the feed should still render if either is down.
    fetch('/api/meetings/agent?action=worklist', { headers: authHeaders })
      .then(r => r.json())
      .then(d => setWorklist((d.items || []).filter(i =>
        i.status !== 'done' && (!i.assignee || i.assignee === user?.name))))
      .catch(() => {})

    if (user?.staff?.hasTimesheets) {
      fetch('/api/timesheet/agent?action=mine', { headers: authHeaders })
        .then(r => r.json())
        .then(d => setTimesheet({ records: d.records || [] }))
        .catch(() => {})
    }
  }, [authHeaders, today, user])

  useEffect(() => { load() }, [load])

  const day = plan?.days.find(d => d.date === today)
  const cases = day?.casesByHospital.flatMap(g => g.cases.map(c => ({ ...c, hospital: g.hospital }))) || []
  const flags = day?.flags || []

  // The one prompt most likely to matter: an unsubmitted fortnight.
  const period = currentPeriod()
  const submitted = timesheet?.records.some(r => r.periodStart === period.start && r.status !== 'rejected')
  const rejected = timesheet?.records.find(r => r.periodStart === period.start && r.status === 'rejected')
  const timesheetDue = user?.staff?.hasTimesheets && timesheet && !submitted

  return (
    <Page>
      <Header
        eyebrow={formatDayHeading(today)}
        title={`${greeting(hour)}${firstName ? `, ${firstName}` : ''}`}
        subtitle={planState === 'ready'
          ? (cases.length
            ? `${cases.length} case${cases.length === 1 ? '' : 's'} today`
            : 'No cases scheduled today')
          : undefined}
      />

      <Body>
        {/* Scan is the action most often wanted, and wanted in a hurry. */}
        <button onClick={() => onNavigate({ tab: 'scan' })}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: space.md,
            background: colour.navy, border: 'none', borderRadius: radius.card,
            padding: `${space.lg}px ${space.md + 2}px`, marginBottom: space.lg,
            cursor: 'pointer', textAlign: 'left', font: 'inherit'
          }}>
          <span style={{
            width: 42, height: 42, borderRadius: radius.control, flexShrink: 0,
            background: 'rgba(255,255,255,0.12)', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <IconScan size={22} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ ...text('bodyStrong'), color: 'white', display: 'block' }}>Scan a usage form</span>
            <span style={{ ...text('caption'), color: 'rgba(255,255,255,0.55)', display: 'block' }}>
              Straight from theatre — reads the whole form
            </span>
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)', display: 'flex' }}><IconChevron size={18} /></span>
        </button>

        {rejected && (
          <Banner tone="danger"
            action={<Button variant="danger" onClick={() => onNavigate({ tab: 'me', sub: 'timesheets' })}>Fix and resubmit</Button>}>
            <strong>Your timesheet was returned.</strong> {rejected.rejectionReason}
          </Banner>
        )}

        {timesheetDue && !rejected && (
          <Banner tone={isPeriodClosed(period.start) ? 'danger' : 'warning'}
            action={<Button variant="secondary" onClick={() => onNavigate({ tab: 'me', sub: 'timesheets' })}>Open timesheet</Button>}>
            <strong>
              {isPeriodClosed(period.start) ? 'Timesheet overdue' : 'Timesheet due Sunday'}
            </strong>
            {' '}— {period.start} to {period.end} hasn't been submitted.
          </Banner>
        )}

        {/* ── Today's cases ── */}
        <SectionLabel style={{ marginTop: 0 }}>Today</SectionLabel>

        {planState === 'loading' && (
          <Card>
            <Skeleton width="45%" height={13} />
            <Skeleton width="70%" height={11} />
            <Skeleton width="30%" height={11} style={{ marginBottom: 0 }} />
          </Card>
        )}

        {planState === 'error' && (
          <Card>
            <div style={{ ...text('caption'), color: colour.inkFaint }}>
              Couldn't reach the calendar. The plan is still available under Cases.
            </div>
          </Card>
        )}

        {planState === 'ready' && flags.map((flag, i) => (
          <Card key={`flag-${i}`} style={{
            background: flag.kind === 'clinicalAlert' ? colour.dangerSoft : colour.accentSoft,
            border: `1px solid ${flag.kind === 'clinicalAlert' ? colour.dangerLine : 'rgba(24,154,133,0.25)'}`,
            display: 'flex', gap: space.sm, alignItems: 'flex-start'
          }}>
            <span style={{ color: flag.kind === 'clinicalAlert' ? colour.danger : colour.accentDeep, display: 'flex', marginTop: 1 }}>
              <IconAlert size={16} />
            </span>
            <span style={{ ...text('caption'), color: flag.kind === 'clinicalAlert' ? colour.danger : colour.accentDeep }}>
              {flag.text}
            </span>
          </Card>
        ))}

        {planState === 'ready' && cases.length === 0 && flags.length === 0 && (
          <Card style={{ display: 'flex', gap: space.md, alignItems: 'center' }}>
            <span style={{ color: colour.inkFainter, display: 'flex' }}><IconCheck size={20} /></span>
            <span style={{ ...text('caption'), color: colour.inkFaint }}>
              Nothing scheduled today.
            </span>
          </Card>
        )}

        {planState === 'ready' && cases.map(c => (
          <Card key={c.id} onClick={() => onNavigate({ tab: 'cases', sub: 'plan' })}
            style={{ display: 'flex', gap: space.md, padding: 0, overflow: 'hidden' }}>
            <span aria-hidden="true" style={{ width: 4, background: accentFor(c.surgeon), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, padding: `${space.md}px ${space.md}px ${space.md}px 0` }}>
              <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>
                {c.patient}
                <span style={{ color: colour.inkFainter, fontWeight: 400 }}> / </span>
                <span style={{ color: accentTextFor(c.surgeon) }}>{c.surgeon}</span>
              </span>
              <span style={{ ...text('caption'), color: colour.inkMuted, display: 'block' }}>{c.procedure}</span>
              <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block', marginTop: 2 }}>
                {formatTimeRange(c.start, c.end)} · {c.hospital}
              </span>
            </span>
          </Card>
        ))}

        {/* ── Your action items, surfaced rather than buried ── */}
        {worklist.length > 0 && (
          <>
            <SectionLabel>Your actions ({worklist.length})</SectionLabel>
            {worklist.slice(0, 4).map(item => (
              <Card key={item.id} onClick={() => onNavigate({ tab: 'cases', sub: 'projects' })}
                style={{ display: 'flex', gap: space.md, alignItems: 'flex-start' }}>
                <span style={{ color: colour.inkFainter, display: 'flex', marginTop: 1 }}><IconTasks size={18} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ ...text('body'), color: colour.ink, display: 'block' }}>{item.task}</span>
                  {item.due_date && (
                    <span style={{ ...text('caption'), color: colour.inkFaint }}>Due {item.due_date}</span>
                  )}
                </span>
              </Card>
            ))}
            {worklist.length > 4 && (
              <button onClick={() => onNavigate({ tab: 'cases', sub: 'projects' })}
                style={{
                  ...text('caption'), width: '100%', background: 'transparent', border: 'none',
                  color: colour.accent, padding: space.sm, cursor: 'pointer', font: 'inherit'
                }}>
                See all {worklist.length} actions
              </button>
            )}
          </>
        )}

        {/* ── The week ahead, as a pointer not a duplicate ── */}
        <SectionLabel>This week</SectionLabel>
        <Card onClick={() => onNavigate({ tab: 'cases', sub: 'plan' })}
          style={{ display: 'flex', gap: space.md, alignItems: 'center' }}>
          <span style={{
            width: 38, height: 38, borderRadius: radius.control, flexShrink: 0,
            background: colour.canvas, color: colour.navy,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <IconCalendar size={20} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ ...text('bodyStrong'), color: colour.ink, display: 'block' }}>Clinical plan</span>
            <span style={{ ...text('caption'), color: colour.inkFaint, display: 'block' }}>
              {plan ? `${plan.surgeons.length || 'No'} surgeon${plan.surgeons.length === 1 ? '' : 's'} this week` : 'Weekly and daily views'}
            </span>
          </span>
          <span style={{ color: colour.inkFainter, display: 'flex' }}><IconChevron size={18} /></span>
        </Card>
      </Body>
    </Page>
  )
}
