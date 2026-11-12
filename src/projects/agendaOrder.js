// ─── The order every agenda keeps (Brent, 12 Nov 2026) ───────────────────────
// "Welcome and apologies, general business at the top, next meeting at the
// bottom." The outstanding actions follow general business (see the screen).
export const isWelcome = t => /welcome|apolog/i.test(String(t || ''))
export const isGeneral = t => /general\s+business/i.test(String(t || ''))
export const isNextMeeting = t => /next\s+meeting/i.test(String(t || ''))

/** The items in the agreed order, the three standing ones always there. Pure. */
export function orderedItems(items = []) {
  const pick = test => items.find(i => test(i.title))
  const welcome = pick(isWelcome) || { id: 'std-welcome', title: 'Welcome and apologies', points: [], lead: '' }
  const general = pick(isGeneral) || { id: 'std-general', title: 'General business', points: [], lead: '' }
  const next = pick(isNextMeeting) || { id: 'std-next', title: 'Next meeting', points: [], lead: '' }
  const rest = items.filter(i => !isWelcome(i.title) && !isGeneral(i.title) && !isNextMeeting(i.title))
  return [welcome, general, ...rest, next]
}
