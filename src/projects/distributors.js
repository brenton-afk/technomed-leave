// ─── Tasks by distributor (Brent, 11 Nov 2026) ───────────────────────────────
// "Build some structure into the table view of the projects page, so that
// things are separated by distributor. Use the information you already know
// about product names to distinguish what belongs with each distributor."
//
// A task's own words decide: a distributor named, or a product of theirs —
// every system in the inventory (src/clinicalPlan/inventory.js) under the
// distributor that supplies it, plus the names the usage reader already uses
// (api/_distributors.js). A task naming two distributors goes under "More
// than one distributor"; naming none, under "No distributor".

import { INVENTORY } from '../clinicalPlan/inventory.js'

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')
const systemsOf = key => INVENTORY.filter(i => i.distributor === key).map(i => esc(i.system))

// Order is the order the groups are shown in.
export const DISTRIBUTORS = [
  { key: 'signus', name: 'Signus', words: ['Signus', ...systemsOf('signus')] },
  { key: 'device', name: 'Device Technologies', words: ['Device\\s*Tech\\w*', 'SeaSpine', 'Sea\\s*Spine', 'Boost', 'Outrigger', 'Rapid\\s*Graft', ...systemsOf('device')] },
  { key: 'e4', name: 'E4 Surgical', words: ['E4', 'E4\\s*Surgical', 'Global\\s*BMD', 'BMD', 'Catenary', 'Reform\\s*(?:Cervical|Lumbar|POCT)', ...systemsOf('e4')] },
  { key: 'kt', name: 'KT Medical', words: ['KT', 'KT\\s*Medical', 'KTM', 'Orthofix', 'Firebird', 'Forza', 'Janus', ...systemsOf('kt')] },
  { key: 'globus', name: 'Nuvasive / Globus', words: ['Globus', 'Nuvasive', 'Nu\\s*Vasive', ...systemsOf('globus')] },
  { key: 'dtbv', name: 'Donor Tissue Bank', words: ['DTBV', 'Donor\\s*Tissue', 'CBM', 'allograft'] },
  { key: 'atec', name: 'ATEC Spine', words: ['ATEC', 'Alphatec'] },
  { key: 'stryker', name: 'Stryker', words: ['Stryker'] },
  { key: 'kls', name: 'KLS Martin', words: ['KLS', 'KLS\\s*Martin'] },
  { key: 'arthrex', name: 'Arthrex', words: ['Arthrex', 'AR300', 'Drill\\s*Saw\\s*Mini'] },
  { key: 'brainlab', name: 'Brainlab', words: ['Brainlab', 'AIRO'] },
  { key: 'technomed', name: 'TechnoMed kits', words: ['TM\\s*Loan', 'TM\\s*Screw\\s*Removal', 'TM\\s*Locking', ...systemsOf('technomed')] }
].map(d => ({ ...d, pattern: new RegExp(`(?:^|[^A-Za-z0-9])(?:${d.words.join('|')})(?![A-Za-z0-9])`, 'i') }))

export const NO_DISTRIBUTOR = { key: 'none', name: 'No distributor' }
export const SEVERAL = { key: 'several', name: 'More than one distributor' }

/** Every distributor a piece of text names. */
export function distributorsIn(...texts) {
  const said = texts.filter(Boolean).join(' ')
  if (!said.trim()) return []
  return DISTRIBUTORS.filter(d => d.pattern.test(said))
}

/** The one group a task goes under. */
export function distributorOf(task) {
  const found = distributorsIn(task?.task, task?.notes)
  if (found.length === 1) return found[0]
  return found.length ? { ...SEVERAL, names: found.map(d => d.name) } : NO_DISTRIBUTOR
}

/** Tasks grouped by distributor, in DISTRIBUTORS order, empty groups left out. */
export function byDistributor(tasks = []) {
  const groups = new Map()
  for (const t of tasks) {
    const d = distributorOf(t)
    if (!groups.has(d.key)) groups.set(d.key, { ...d, tasks: [] })
    groups.get(d.key).tasks.push(t)
  }
  const order = [...DISTRIBUTORS.map(d => d.key), SEVERAL.key, NO_DISTRIBUTOR.key]
  return order.filter(k => groups.has(k)).map(k => groups.get(k))
}
