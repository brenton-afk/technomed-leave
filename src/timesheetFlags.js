// ─── What Erin needs to look at on a timesheet (Brent, 14 Nov 2026) ──────────
// "One screen that shows only what's unusual … with an Approve all clean
// ones button … she still needs to review them." Each submitted timesheet
// gets a short list of chips; `needsDecision` is the one thing that stops
// Approve all — overtime claimed at double time has to be paid or banked.
// Pure; shared by Admin → Timesheets and its tests.

const sum = row => Object.values(row || {}).reduce((s, v) => s + Number(v || 0), 0)
const r2 = n => Math.round(n * 100) / 100

/** [{ kind, text, tone }] for one timesheet record. */
export function flagsFor(record) {
  const out = []
  const claim = record?.overtimeClaim
  if (claim?.status === 'pending') out.push({ kind: 'overtime', text: `${claim.hours}h overtime claimed — decide`, tone: 'decide' })
  if (record?.toilOverflow?.excess) out.push({ kind: 'toil-banked', text: `${record.toilOverflow.excess}h TOIL banked`, tone: 'info' })
  const taken = sum(record?.toilTaken)
  if (taken) out.push({ kind: 'toil-taken', text: `${r2(taken)}h TOIL taken`, tone: 'info' })
  const callIns = sum(record?.entries?.call_in)
  if (callIns) out.push({ kind: 'call-ins', text: `${callIns} call-in${callIns === 1 ? '' : 's'}`, tone: 'info' })
  const onCall = sum(record?.entries?.on_call)
  if (onCall) out.push({ kind: 'on-call', text: `${r2(onCall)}h on call`, tone: 'info' })
  const leave = Number(record?.leave?.total || 0)
  if (leave) out.push({ kind: 'leave', text: `${r2(leave)}h leave`, tone: 'info' })
  const notInXero = (record?.leave?.rows || []).some(r => r.inXero === false)
  if (notInXero) out.push({ kind: 'leave-xero', text: 'Leave not in Xero', tone: 'warn' })
  for (const w of record?.warnings || []) {
    if (/claimed as overtime|banked as TOIL/.test(w)) continue // already a chip
    out.push({ kind: 'warning', text: w, tone: 'warn' })
  }
  return out
}

/** Whether Approve all must leave this one for Erin to open. */
export const needsDecision = record => record?.overtimeClaim?.status === 'pending'
