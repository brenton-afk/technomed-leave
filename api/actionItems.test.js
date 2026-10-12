import { describe, it, expect } from 'vitest'
import { readActionList, completeObjects, withoutFences } from './_actionItems.js'

// ─── The answer that ran out of room ─────────────────────────────────────────
// "Error JSON at position 6964 line 138 col 50 unterminated string in JSON."
//
// Not a malformed reply — a reply that stopped mid-word. The request asked for
// 2,000 tokens, a long action list is more than that, and position 6964 is
// almost exactly where 2,000 tokens of JSON ends. The limit is raised, which
// fixes the reported case. This is for the next one, because a limit is a
// number somebody chose and lists get longer.

const item = (task, assignee = 'Toni Hoppitt') =>
  `{"task":"${task}","assignee":"${assignee}","priority":"normal","due_date":"","notes":"Said on Monday."}`

const whole = (...tasks) =>
  `{"summary":"A meeting happened.","actionItems":[${tasks.map(t => item(t)).join(',')}]}`

describe('the ordinary answer', () => {
  it('reads as it always did', () => {
    const out = readActionList(whole('Chase the Globus paperwork'))
    expect(out.summary).toBe('A meeting happened.')
    expect(out.actionItems).toHaveLength(1)
    expect(out.actionItems[0].task).toBe('Chase the Globus paperwork')
    expect(out.truncated).toBe(false)
  })

  it('survives the fences a model adds when asked not to', () => {
    const out = readActionList('```json\n' + whole('Book the in-service') + '\n```')
    expect(out.actionItems).toHaveLength(1)
  })

  it('says so when the answer was cut short even though it parsed', () => {
    // A list that happens to end on a closing brace is still a short list.
    const out = readActionList(whole('One thing'), { stopReason: 'max_tokens' })
    expect(out.truncated).toBe(true)
  })
})

describe('the answer that stopped mid-word', () => {
  // The reported shape: complete items, then half of one more.
  const cut = `{"summary":"A long meeting.","actionItems":[`
    + `${item('Chase the Globus paperwork')},`
    + `${item('Book the Calvary in-service')},`
    + `{"task":"Order two Reform screws for Thurs`

  it('keeps the items that are whole', () => {
    const out = readActionList(cut)
    expect(out.actionItems).toHaveLength(2)
    expect(out.actionItems.map(i => i.task)).toEqual([
      'Chase the Globus paperwork',
      'Book the Calvary in-service'
    ])
  })

  it('drops only the one that was half written', () => {
    expect(readActionList(cut).actionItems.map(i => i.task))
      .not.toContain(expect.stringContaining('Reform screws'))
  })

  it('says it is short, so nobody has to notice on their own', () => {
    expect(readActionList(cut).truncated).toBe(true)
  })

  it('keeps the summary, which is written before the list', () => {
    expect(readActionList(cut).summary).toBe('A long meeting.')
  })

  it('does not throw, which is what the reported error did', () => {
    expect(() => readActionList(cut)).not.toThrow()
  })
})

describe('what it refuses', () => {
  it('stops when there is nothing usable at all', () => {
    // A different problem from truncation, and worth stopping on.
    expect(() => readActionList('I could not find any action items, sorry.'))
      .toThrow(/could not be read/)
  })

  it('stops on an empty answer', () => {
    expect(() => readActionList('')).toThrow(/returned nothing/)
  })

  it('says what happened in words a person can act on', () => {
    // "Unterminated string in JSON at position 6964" tells whoever pasted the
    // transcript nothing.
    try {
      readActionList('{"summary":"half a sum')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.message).toMatch(/paste a shorter section|returned nothing/)
      expect(err.message).not.toMatch(/position \d+/)
    }
  })
})

describe('finding the objects', () => {
  it('is not fooled by a brace inside a task', () => {
    // "order 2 (one spare)" is ordinary, and a brace-counting regex gets
    // a task containing { or } wrong.
    const text = `[{"task":"Order 2 {one spare} Reform screws","assignee":"Ben Cassidy"}]`
    expect(completeObjects(text)).toHaveLength(1)
    expect(JSON.parse(completeObjects(text)[0]).task)
      .toBe('Order 2 {one spare} Reform screws')
  })

  it('is not fooled by an escaped quote', () => {
    const text = `[{"task":"Ring the \\"other\\" Jesse","assignee":"Unassigned"}]`
    expect(completeObjects(text)).toHaveLength(1)
  })

  it('does not read the summary as an item', () => {
    // The summary comes first and can contain anything. Reading from
    // "actionItems" onwards is what keeps it out.
    const out = readActionList(
      `{"summary":"We discussed {the thing}.","actionItems":[${item('Do it')},{"task":"half`)
    expect(out.actionItems).toHaveLength(1)
    expect(out.actionItems[0].task).toBe('Do it')
  })

  it('takes the fences off', () => {
    expect(withoutFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
})
