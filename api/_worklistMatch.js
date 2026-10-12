// ─── "Haven't we said this already?" ─────────────────────────────────────────
// "The same action comes up at the weekly meeting three weeks running."
//
// It will. A standing item — chase the Globus paperwork, book the Calvary
// in-service — gets said again every Monday until it is done, and each meeting
// produces another copy of it. Three weeks of that and the list stops being
// believed, which is worse than it being short.
//
// Flagged, never merged. Brent's call, and the right one: two tasks that read
// alike are sometimes two different jobs — "ring Device about the Mariner" in
// September and again in October can be the same unfinished thing or two
// separate trays. The app cannot tell. A person reading both in two seconds
// can, and a merge is much harder to undo than a dismissal.
//
// So this answers "which open item is this most like, and how alike", and the
// review screen puts the two side by side.

/**
 * Words that carry no signal about which task this is.
 *
 * Deliberately includes the verbs that start almost every action — "chase",
 * "follow up", "send" — because two tasks both beginning "follow up with"
 * are not thereby similar, and leaving them in made everything match
 * everything.
 */
const NOISE = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'for', 'with', 'on', 'at',
  'in', 'by', 'from', 'about', 'into', 'up', 'out', 'is', 'are', 'be', 'been',
  'get', 'got', 'make', 'made', 'do', 'does', 'done', 'need', 'needs', 'needed',
  'please', 'asap', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our',
  'us', 'i', 'you', 'they', 'them', 'their', 'can', 'will', 'should', 'must',
  'follow', 'chase', 'send', 'sort', 'check', 'look', 'ring', 'call', 'email',
  'ask', 'confirm', 'organise', 'organize', 'arrange', 'sure'
])

/** The words of a task that actually say which task it is. */
export function keyWords(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !NOISE.has(w))
  )
}

/**
 * How alike two tasks are, 0 to 1.
 *
 * Jaccard over the meaningful words — shared ÷ total — so a short task and a
 * long one that happens to contain it do not count as the same thing. "Chase
 * the Globus paperwork" against "chase the Globus paperwork and book the
 * in-service" is 0.5, which is a flag rather than a certainty, and that is
 * right: it may be the same job grown, or the first one plus a new one.
 */
export function similarity(a, b) {
  const left = keyWords(a)
  const right = keyWords(b)
  if (!left.size || !right.size) return 0

  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1
  return shared / (left.size + right.size - shared)
}

/**
 * Enough alike to be worth a person's two seconds.
 *
 * 0.55, not half. At half, "book the Calvary in-service" and "book the RHH
 * in-service" match: they share two words out of four, and the two they share
 * are the generic ones while the two they do not are the whole point. Which
 * hospital is not a detail that loses a vote.
 *
 * The cost of being wrong here is not symmetric, which is what sets it. A
 * missed repeat leaves a duplicate on the board, and somebody deletes it next
 * week. A false flag invites somebody to delete a task that was never done.
 */
const LOOKS_THE_SAME = 0.55

/** And not on the strength of one shared word, which is a coincidence. */
const SHARED_WORDS = 2

/**
 * The open item a new task most resembles, or null.
 *
 * Only open ones: a task that was done in September and comes up again in
 * October is a new job, not a duplicate, and flagging it would tell somebody
 * to dismiss the very thing they should be doing.
 *
 * Assignee is a filter rather than a signal. Two people can be given the same
 * job in different weeks and that is still worth noticing — but a task for
 * Toni and a task for Ben that read alike are two tasks, so they only match
 * when one of them has nobody on it yet.
 */
export function likelyRepeat(task, openItems = []) {
  const candidates = (openItems || [])
    .filter(item => item && item.status !== 'done' && item.status !== 'archived')
    .filter(item => {
      const mine = String(task?.assignee || 'Unassigned')
      const theirs = String(item.assignee || 'Unassigned')
      return mine === theirs || mine === 'Unassigned' || theirs === 'Unassigned'
    })
    .map(item => {
      const score = similarity(task?.task, item.task)
      const shared = [...keyWords(task?.task)].filter(w => keyWords(item.task).has(w))
      return { item, score, shared }
    })
    .filter(c => c.score >= LOOKS_THE_SAME && c.shared.length >= SHARED_WORDS)
    .sort((a, b) => b.score - a.score)

  if (!candidates.length) return null
  const best = candidates[0]
  return {
    id: best.item.id,
    task: best.item.task,
    assignee: best.item.assignee,
    sourceMeetingTitle: best.item.sourceMeetingTitle || '',
    sourceMeetingDate: best.item.sourceMeetingDate || '',
    score: Math.round(best.score * 100) / 100
  }
}

/** Every draft item, each with whatever open item it looks like. */
export function flagRepeats(items = [], openItems = []) {
  return (items || []).map(item => {
    const repeat = likelyRepeat(item, openItems)
    return repeat ? { ...item, possibleRepeatOf: repeat } : item
  })
}
