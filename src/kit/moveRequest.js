// ─── Find a tray, and read a spoken move (Brent, 21 Nov 2026) ───────────────
// "Within each kit … you need a search function so you can find a kit quickly
// to do a transfer. Also need a speech function so you can ask to move a
// specific kit: 'I want to move the Diplomat torque and reduction tray from RHH
// to Calvary.'" Both read words against the kit room's own names, here, with
// no model: the names are a short closed list, and a wrong guess only opens the
// move sheet — nothing moves until its email step is confirmed. Pure.

const PLACE_WORDS = [
  [/^(calvary|clv|lenah valley|st johns?)$/, 'CLV'],
  [/^(rhh|royal hobart( hospital)?|royal|the royal)$/, 'RHH'],
  [/^(the )?(tm |technomed )?(office|home|warehouse|base)$|^technomed$/, 'office']
]
export const PLACE_NAMES = { CLV: 'Calvary', RHH: 'RHH', office: 'TM office' }

const NUMBERS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', first: '1', second: '2', third: '3' }
const FILLER = new Set(('i want wanna to move moving send sending transfer transferring take taking the a an from please ' +
  'can you could we need needs would like it its this that tray trays set kit of at over and for me our ' +
  'just now today tomorrow get bring put going is be lets let us').split(' '))

const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
export const wordsOf = s => norm(s).split(' ').filter(Boolean).map(w => NUMBERS[w] || w)

function close(a, b) {
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  // One letter wrong, missing or extra — speech gets names slightly wrong.
  let i = 0; let j = 0; let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue }
    edits += 1
    if (edits > 1) return false
    if (a.length > b.length) i += 1
    else if (b.length > a.length) j += 1
    else { i += 1; j += 1 }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}
const hits = (word, names) => names.some(n => close(word, n))

/** Every word of the search is somewhere in the text (loosely). */
export function matchesSearch(query, text) {
  const q = wordsOf(query)
  if (!q.length) return true
  const names = wordsOf(text)
  return q.every(w => hits(w, names))
}

export const placeOf = word => (PLACE_WORDS.find(([re]) => re.test(word)) || [])[1] || ''

/** "from RHH to Calvary" — the places said, and the words left over. */
export function placesSaid(text) {
  let rest = ` ${norm(text)} `
  const take = dir => {
    const re = new RegExp(`\\b${dir} (the )?(royal hobart hospital|royal hobart|lenah valley|st johns?|tm office|technomed office|the royal|calvary|clv|rhh|royal|office|home|warehouse|base|technomed)\\b`)
    const m = rest.match(re)
    if (!m) return ''
    rest = rest.replace(m[0], ' ')
    return placeOf(m[2])
  }
  const from = take('from')
  const to = take('to') || take('back to') || take('into') || take('over to')
  return { from, to, rest: rest.trim() }
}

const trayPlace = (kit, tray) => kit.trayAt?.[tray]?.at || kit.at

/**
 * Read "move the Diplomat torque and reduction tray from RHH to Calvary"
 * against the kits. Returns { to, from, heard, choices: [{ kitId, trays,
 * label, at }] }, best first; `trays: null` is the whole set.
 */
export function readMoveRequest(text, kits = []) {
  const { from, to, rest } = placesSaid(text)
  const words = wordsOf(rest).filter(w => !FILLER.has(w))
  const whole = /\b(whole|entire|full|all)\b/.test(norm(text)) && /\b(kit|set|system)\b/.test(norm(text))
  const out = { from, to, heard: String(text || '').trim(), choices: [] }
  if (!words.length) return out

  const scored = []
  for (const kit of kits) {
    const sysWords = wordsOf(`${kit.system || ''} ${kit.name || ''}`)
    const sysHits = words.filter(w => hits(w, sysWords)).length
    const trays = whole ? [] : (kit.trays || [])
    for (const tray of trays) {
      const tw = wordsOf(tray)
      const trayHits = words.filter(w => hits(w, tw)).length
      const all = words.filter(w => hits(w, [...sysWords, ...tw])).length
      if (!trayHits && !sysHits) continue
      const spare = tw.filter(n => !words.some(w => close(w, n)) && !sysWords.includes(n)).length
      scored.push({ kit, tray, at: trayPlace(kit, tray), score: all * 10 + trayHits * 3 - spare - (all < words.length ? (words.length - all) * 4 : 0) })
    }
    if (sysHits && (whole || !(kit.trays || []).length)) {
      scored.push({ kit, tray: null, at: kit.at, score: sysHits * 10 - (words.length - sysHits) * 4 + (whole ? 5 : 0) })
    }
  }
  // Said where it is now: only what is there, unless nothing is.
  const there = from ? scored.filter(s => s.at === from) : scored
  const pool = (there.length ? there : scored).filter(s => !to || s.at !== to || !there.length)
  pool.sort((a, b) => b.score - a.score)
  const top = pool[0]?.score
  out.choices = pool.filter(s => s.score >= top - 6).slice(0, 5).map(s => ({
    kitId: s.kit.id,
    trays: s.tray ? [s.tray] : null,
    at: s.at,
    label: s.tray ? s.tray : `The whole ${s.kit.name || s.kit.system} set`,
    system: s.kit.system || s.kit.name || ''
  }))
  return out
}

/** The words a recording is primed with: every system and tray name. */
export function kitVocabulary(kits = []) {
  const set = new Set()
  for (const k of kits) for (const w of `${k.system || ''} ${k.name || ''} ${(k.trays || []).join(' ')}`.split(/[^A-Za-z0-9-]+/)) if (w.length > 2) set.add(w)
  return [...set].slice(0, 600)
}
