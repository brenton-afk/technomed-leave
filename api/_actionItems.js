// ─── Reading an action list back out of a model's answer ─────────────────────
// "Error JSON at position 6964 line 138 col 50 unterminated string in JSON."
//
// That is a reply that ran out of room, not a reply that was malformed. The
// request asked for 2,000 tokens, a long action list is more than that, and the
// answer stopped in the middle of a word. Position 6964 is almost exactly where
// 2,000 tokens of JSON ends.
//
// The limit is raised, which fixes the case that was reported. This exists for
// the next one, because a limit is a number somebody chose and lists get longer:
//
//   · a truncated answer is salvaged rather than thrown away. Thirty complete
//     items followed by half of a thirty-first is thirty items, and losing all
//     thirty because the last one is cut in half is the worst of the available
//     outcomes
//   · what was lost is reported. A list that is quietly shorter than the
//     meeting is worse than an error, because nobody goes looking for the
//     items that are not there
//   · the error, where there is one, says what happened in words. "Unterminated
//     string in JSON at position 6964" tells whoever pasted the transcript
//     nothing they can act on

/** The fences a model puts round JSON when asked not to. */
export function withoutFences(text) {
  return String(text || '').replace(/```(?:json)?/gi, '').trim()
}

/**
 * The complete objects in a possibly-truncated array.
 *
 * Walked character by character rather than matched with a pattern, because
 * the strings inside contain braces — a task reading "order 2 (one spare)" is
 * ordinary — and a brace-counting regex gets those wrong. Quotes and escapes
 * are tracked for the same reason.
 *
 * An object that is not closed by the end of the text is dropped. It is the
 * one that was half written.
 */
export function completeObjects(text) {
  const out = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (escaped) { escaped = false; continue }
    if (ch === '\\' && inString) { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue

    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1))
        start = -1
      }
      if (depth < 0) depth = 0
    }
  }
  return out
}

/**
 * The summary, as far as one was written.
 *
 * Taken separately because it comes first in the answer and so survives a
 * truncation that costs the tail of the list.
 */
function summaryFrom(text) {
  const m = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)
  if (!m) return ''
  try {
    return JSON.parse(`"${m[1]}"`)
  } catch {
    return m[1]
  }
}

/**
 * An action list out of whatever came back.
 *
 * Never throws for a truncated answer — that is the case this is for. It
 * throws only when there is nothing usable at all, which is a different
 * problem and worth stopping on.
 *
 * @returns {{summary: string, actionItems: object[], truncated: boolean}}
 */
export function readActionList(text, { stopReason } = {}) {
  const cleaned = withoutFences(text)
  if (!cleaned) throw new Error('The agent returned nothing to read.')

  // The ordinary path: it is valid JSON and this is all over in a microsecond.
  try {
    const parsed = JSON.parse(cleaned)
    const items = Array.isArray(parsed.actionItems) ? parsed.actionItems : []
    return {
      summary: parsed.summary || '',
      actionItems: items,
      truncated: stopReason === 'max_tokens'
    }
  } catch {
    // Fall through and salvage.
  }

  // Everything after "actionItems": [ — before that is the summary, and a
  // summary containing a brace would otherwise be read as an item.
  const at = cleaned.indexOf('"actionItems"')
  const listPart = at >= 0 ? cleaned.slice(at) : cleaned

  const items = []
  for (const chunk of completeObjects(listPart)) {
    try {
      items.push(JSON.parse(chunk))
    } catch {
      // One unreadable object does not cost the rest of them.
    }
  }

  if (!items.length) {
    throw new Error(
      'The agent\'s answer could not be read, and no complete action items '
      + 'could be recovered from it. Try again, or paste a shorter section.')
  }

  return { summary: summaryFrom(cleaned), actionItems: items, truncated: true }
}
