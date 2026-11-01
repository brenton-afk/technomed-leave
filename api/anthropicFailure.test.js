import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Task 2: when Claude will not answer ─────────────────────────────────────
// Ben, in the New booking screen: a raw 400 invalid_request_error reading "Your
// credit balance is too low to access the Anthropic API".
//
// Three failures in one screenshot — an unpaid bill nobody knew about, the
// API's own JSON on a phone, and no timeout, so the slow version of the same
// problem is a 504 that looks like nothing happening at all.

const alerts = []
const redisCalls = []
let firstOfDay = true

vi.mock('./_email.js', () => ({
  sendServiceAlertEmail: vi.fn(async a => { alerts.push(a) })
}))

vi.mock('./_redis.js', () => ({
  redis: vi.fn(async (command, key) => {
    redisCalls.push({ command, key })
    if (command === 'setnx') return firstOfDay ? 1 : 0
    return 1
  })
}))

const create = vi.fn()
const stream = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(opts) { this.opts = opts; seen.push(opts) }
    get messages() { return { create, stream } }
  }
}))

const seen = []

const {
  askClaude, streamClaude, classify, alertOnce, AiUnavailable, AI_TIMEOUT_MS
} = await import('./_anthropic.js')

const FRIENDLY = 'Voice booking is unavailable right now — please fill in the form below.'

const ask = () => askClaude({
  feature: 'voice-booking',
  whenUnavailable: FRIENDLY,
  request: { model: 'claude-opus-5', max_tokens: 10, messages: [] }
})

/** The shape the SDK throws. */
const apiError = (status, message, name) => {
  const err = new Error(message)
  err.status = status
  if (name) err.name = name
  return err
}

beforeEach(() => {
  alerts.length = 0
  redisCalls.length = 0
  seen.length = 0
  firstOfDay = true
  process.env.ANTHROPIC_API_KEY = 'sk-test'
  create.mockReset()
  stream.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

describe('what staff are shown', () => {
  it('shows the caller’s sentence, never the API’s', async () => {
    create.mockRejectedValue(apiError(400,
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API"}}'))
    await expect(ask()).rejects.toThrow(FRIENDLY)
  })

  it('keeps no JSON, no status code and no request id in the message', async () => {
    create.mockRejectedValue(apiError(400, '400 {"request_id":"req_abc123"} credit balance'))
    try {
      await ask()
      throw new Error('should have thrown')
    } catch (err) {
      expect(err.message).not.toMatch(/\{|request_id|400|invalid_request_error/)
      expect(err.detail).toMatch(/credit balance/)
    }
  })

  it('points at the thing the person can actually do instead', async () => {
    // The manual form is right underneath, which is what makes this a workable
    // answer rather than a dead end.
    create.mockRejectedValue(apiError(500, 'overloaded'))
    await expect(ask()).rejects.toThrow(/fill in the form below/)
  })

  it('says the same thing when the key was never configured', async () => {
    // A deploy that was never finished, not an outage — but the difference is
    // not one the person reading it can act on.
    delete process.env.ANTHROPIC_API_KEY
    await expect(ask()).rejects.toThrow(FRIENDLY)
  })
})

describe('telling the difference between kinds of failure', () => {
  it('knows an unpaid bill', () => {
    expect(classify(apiError(400, 'Your credit balance is too low'))).toBe('billing')
  })

  it('knows a bad key', () => {
    expect(classify(apiError(401, 'authentication_error'))).toBe('auth')
    expect(classify(apiError(403, 'forbidden'))).toBe('auth')
  })

  it('knows a busy service from a broken account', () => {
    // One of these is worth waking somebody for and the other is not.
    expect(classify(apiError(529, 'overloaded_error'))).toBe('busy')
    expect(classify(apiError(429, 'rate_limit'))).toBe('busy')
    expect(classify(apiError(500, 'internal'))).toBe('busy')
  })

  it('knows a timeout', () => {
    expect(classify(apiError(undefined, 'Request timed out', 'APIConnectionTimeoutError')))
      .toBe('timeout')
  })

  it('does not call a request bug an outage', () => {
    expect(classify(apiError(400, 'messages: at least one message is required')))
      .toBe('unknown')
  })
})

describe('telling Brent, once', () => {
  it('emails on an unpaid bill', async () => {
    create.mockRejectedValue(apiError(400, 'Your credit balance is too low'))
    await expect(ask()).rejects.toThrow()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ feature: 'voice-booking', fault: 'billing' })
  })

  it('emails on a bad key', async () => {
    create.mockRejectedValue(apiError(401, 'invalid x-api-key'))
    await expect(ask()).rejects.toThrow()
    expect(alerts[0].fault).toBe('auth')
  })

  it('stays quiet for a busy service', async () => {
    // It will clear on its own, and an alert nobody needs to act on is an
    // alert that teaches people to ignore the sender.
    create.mockRejectedValue(apiError(529, 'overloaded_error'))
    await expect(ask()).rejects.toThrow()
    expect(alerts).toHaveLength(0)
  })

  it('sends once a day, however many people hit it', async () => {
    // The failure mode is every staff member meeting the same dead API all
    // morning. One alert is information; forty is a reason to filter it.
    create.mockRejectedValue(apiError(400, 'credit balance'))
    await expect(ask()).rejects.toThrow()
    firstOfDay = false
    await expect(ask()).rejects.toThrow()
    await expect(ask()).rejects.toThrow()
    expect(alerts).toHaveLength(1)
  })

  it('keeps a separate day-key per feature', async () => {
    await alertOnce('voice-booking', 'billing', 'x', '2026-11-01')
    expect(redisCalls[0].key).toBe('ai-alert:voice-booking:2026-11-01')
  })

  it('never lets the alert break the thing that failed', async () => {
    // The most likely reason the alert fails is the thing being alerted about.
    const { redis } = await import('./_redis.js')
    redis.mockRejectedValueOnce(new Error('Upstash down'))
    create.mockRejectedValue(apiError(400, 'credit balance'))
    await expect(ask()).rejects.toThrow(FRIENDLY)
  })

  it('carries no case or patient detail, because the failure is about an account', async () => {
    create.mockRejectedValue(apiError(400, 'credit balance'))
    await expect(ask()).rejects.toThrow()
    expect(Object.keys(alerts[0]).sort()).toEqual(['detail', 'fault', 'feature'])
  })
})

describe('not waiting forever', () => {
  it('gives up after twenty seconds', async () => {
    // There was no timeout at all. The SDK default is ten minutes, inside a
    // function Vercel kills — so the slow failure was a 504, which is the one
    // thing the app cannot turn into a sentence.
    create.mockResolvedValue({ content: [] })
    await ask()
    expect(seen[0].timeout).toBe(AI_TIMEOUT_MS)
    expect(AI_TIMEOUT_MS).toBe(20000)
  })

  it('retries at most once, so the budget is not spent three times over', async () => {
    create.mockResolvedValue({ content: [] })
    await ask()
    expect(seen[0].maxRetries).toBe(1)
  })

  it('gives a streamed scan the whole function instead', async () => {
    // A vision pass over six scanned pages legitimately takes most of a
    // minute; twenty seconds would break a working feature.
    stream.mockReturnValue({ finalMessage: async () => ({ content: [] }) })
    await streamClaude({
      feature: 'usage-scan', whenUnavailable: 'x', request: { messages: [] }
    })
    expect(seen[0].timeout).toBe(55000)
  })

  it('turns a timeout into the same sentence', async () => {
    create.mockRejectedValue(
      apiError(undefined, 'Request timed out', 'APIConnectionTimeoutError'))
    await expect(ask()).rejects.toThrow(FRIENDLY)
  })
})

describe('when it works', () => {
  it('returns the reply untouched', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'hello' }] })
    await expect(ask()).resolves.toMatchObject({
      content: [{ type: 'text', text: 'hello' }]
    })
  })

  it('tells nobody anything', async () => {
    create.mockResolvedValue({ content: [] })
    await ask()
    expect(alerts).toHaveLength(0)
  })
})

describe('the error type', () => {
  it('carries the fault so a caller can decide differently', () => {
    const err = new AiUnavailable('Friendly', 'raw detail', 'billing')
    expect(err.message).toBe('Friendly')
    expect(err.fault).toBe('billing')
    expect(err.detail).toBe('raw detail')
  })

  it('does not trust a fault it does not know', () => {
    expect(new AiUnavailable('x', 'y', 'invented').fault).toBe('unknown')
  })
})
