// ─── The meeting report (Brent, 11 Nov 2026) ─────────────────────────────────
// "When Erin prepares for the next meeting a month later, she needs to be able
// to produce a report of all of the items that were completed and all of the
// items that are still outstanding."
//
// Pure: given the worklist, the meeting it starts from and the day it runs to,
// what was done and what is still open. Sections:
//   fromMeeting   that meeting's action items — done (who, when) / still open
//   earlier       action items from earlier meetings still open
//   other         other tasks finished in the period (not from a meeting)
// A task put away (archived) unfinished is listed apart, never as done.

const day = v => String(v || '').slice(0, 10)

/** When a task was finished, as YYYY-MM-DD — doneAt, else its last change. */
export function doneOn(t) {
  return t?.status === 'done' ? day(t.doneAt || t.updatedAt || t.createdAt) : ''
}

const byAssigneeThenDue = (a, b) => String(a.assignee || '').localeCompare(String(b.assignee || ''))
  || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))
  || String(a.task || '').localeCompare(String(b.task || ''))

export function meetingReport(items = [], meeting, { to, today = to } = {}) {
  const from = day(meeting?.date)
  const until = day(to) || today
  const inPeriod = d => d && d >= from && d <= until
  const overdue = t => Boolean(t.due_date && t.due_date < today)
  const shape = t => ({
    id: t.id, task: t.task, assignee: t.assignee || 'Unassigned', due_date: t.due_date || '',
    doneOn: doneOn(t), doneBy: t.doneBy || '', overdue: t.status !== 'done' && overdue(t),
    meeting: t.sourceMeetingTitle || '', meetingDate: day(t.sourceMeetingDate)
  })

  const ofMeeting = items.filter(t => t.sourceMeetingId === meeting?.id)
  const done = ofMeeting.filter(t => t.status === 'done').map(shape).sort(byAssigneeThenDue)
  const open = ofMeeting.filter(t => t.status !== 'done' && !t.archived).map(shape).sort(byAssigneeThenDue)
  const putAway = ofMeeting.filter(t => t.status !== 'done' && t.archived).map(shape).sort(byAssigneeThenDue)

  const earlier = items
    .filter(t => t.sourceMeetingId && t.sourceMeetingId !== meeting?.id && t.status !== 'done' && !t.archived
      && day(t.sourceMeetingDate) && day(t.sourceMeetingDate) < from)
    .map(shape).sort(byAssigneeThenDue)
  const earlierDone = items
    .filter(t => t.sourceMeetingId && t.sourceMeetingId !== meeting?.id && t.status === 'done'
      && day(t.sourceMeetingDate) < from && inPeriod(doneOn(t)))
    .map(shape).sort(byAssigneeThenDue)
  const other = items
    .filter(t => !t.sourceMeetingId && t.status === 'done' && inPeriod(doneOn(t)))
    .map(shape).sort(byAssigneeThenDue)

  // Each person's tally, for the top of the report.
  const people = {}
  for (const t of [...done, ...open]) {
    const p = (people[t.assignee] ||= { done: 0, open: 0, overdue: 0 })
    if (t.doneOn) p.done += 1
    else { p.open += 1; if (t.overdue) p.overdue += 1 }
  }

  return {
    from, to: until,
    meeting: { id: meeting?.id, title: meeting?.title || 'Meeting', date: from },
    done, open, putAway, earlier, earlierDone, other,
    people: Object.entries(people).map(([name, n]) => ({ name, ...n })).sort((a, b) => a.name.localeCompare(b.name)),
    totals: { items: ofMeeting.length, done: done.length, open: open.length, overdue: open.filter(t => t.overdue).length }
  }
}

const dmy = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Hobart' }) : '')

/** The report as plain text, for an email or the agenda. */
export function reportText(r) {
  const line = t => `• ${t.task} — ${t.assignee}`
    + (t.doneOn ? ` (done ${dmy(t.doneOn)}${t.doneBy && t.doneBy !== t.assignee.split(' ')[0] ? ` by ${t.doneBy}` : ''})`
      : t.due_date ? ` (due ${dmy(t.due_date)}${t.overdue ? ', overdue' : ''})` : '')
  const block = (title, list) => (list.length ? [`${title} (${list.length})`, ...list.map(line), ''] : [])
  return [
    `Action items — ${r.meeting.title}, ${dmy(r.from)} to ${dmy(r.to)}`,
    `${r.totals.done} of ${r.totals.items} done, ${r.totals.open} outstanding${r.totals.overdue ? ` (${r.totals.overdue} overdue)` : ''}.`,
    '',
    ...block('Completed', r.done),
    ...block('Outstanding', r.open),
    ...block('Still open from earlier meetings', r.earlier),
    ...block('Earlier meetings\' items completed in this period', r.earlierDone),
    ...block('Other tasks completed in this period', r.other),
    ...block('Put away without being done', r.putAway)
  ].join('\n').trim()
}
