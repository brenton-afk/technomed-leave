// ─── A private board for Brent and Erin (Brent, 11 Nov 2026) ─────────────────
// "We also need a private board for Erin and Brent that cannot be viewed by
// other staff." A project marked `private` — and every task on it — is served
// only to the people in PRIVATE_BOARD_USERS (default Brent and Erin). For
// anyone else it does not exist: left out of the board, the worklist, search
// and repeat checks, and a direct read or edit of one answers 404, the same as
// a task that is not there. Hiding it in the app alone would leave it in every
// phone's download.

import { getProjects } from './_redis.js'

const DEFAULT_USERS = 'brenton@technomed.com.au,erin@technomed.com.au'

export function privateBoardUsers() {
  return String(process.env.PRIVATE_BOARD_USERS || DEFAULT_USERS)
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export const canSeePrivate = email => privateBoardUsers().includes(String(email || '').toLowerCase())

/** The ids of every private project. */
export function privateIds(projects = []) {
  return new Set(projects.filter(p => p && p.private).map(p => String(p.id)))
}

/**
 * What this person may see: projects and tasks with the private ones left
 * out unless they are on the private board. Pure, for the tests.
 */
export function visibleTo(email, { projects = [], items = [] }) {
  if (canSeePrivate(email)) return { projects, items }
  const hidden = privateIds(projects)
  return {
    projects: projects.filter(p => !hidden.has(String(p?.id))),
    items: items.filter(t => !hidden.has(String(t?.projectId || '')))
  }
}

/** Whether this task or project may be read or changed by this person. */
export function mayTouch(email, { projectId, projects }) {
  if (canSeePrivate(email) || !projectId) return true
  return !privateIds(projects).has(String(projectId))
}

/** The same, reading the projects itself. */
export async function hiddenProjectIdsFor(email) {
  if (canSeePrivate(email)) return new Set()
  try {
    return privateIds(await getProjects())
  } catch {
    // Projects unreadable: which are private is unknown, so every task on a
    // project is held back rather than risk showing a private one.
    return { has: id => Boolean(id) }
  }
}
