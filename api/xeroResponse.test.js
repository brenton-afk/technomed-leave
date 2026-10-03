import { describe, it, expect } from 'vitest'
import { readXero } from './_xeroResponse.js'

// A staff member submitting a timesheet on a Sunday morning was told:
//
//   Unexpected token '<', "<Response" ... is not valid JSON
//
// Xero's payroll API answers errors with XML whatever the Accept header asks
// for. Every call did `await res.json()`, which throws on the first angle
// bracket — and the thrown parse error then replaced the real message. The
// failure was bad; losing the reason was worse.

const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body
})

describe('when Xero answers in XML', () => {
  const XERO_XML = `<?xml version="1.0" encoding="utf-8"?>
<Response xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <ErrorNumber>10</ErrorNumber>
  <Type>ValidationException</Type>
  <Message>A validation exception occurred</Message>
  <Elements>
    <DataContractBase>
      <ValidationErrors>
        <ValidationError><Message>Timesheet overlaps an existing timesheet</Message></ValidationError>
      </ValidationErrors>
    </DataContractBase>
  </Elements>
</Response>`

  it('does not throw on the angle bracket', async () => {
    await expect(readXero(reply(XERO_XML, 400))).resolves.toBeTruthy()
  })

  it('reports what Xero actually said', async () => {
    const { ok, error } = await readXero(reply(XERO_XML, 400), 'Xero timesheet')
    expect(ok).toBe(false)
    expect(error).toContain('Timesheet overlaps an existing timesheet')
  })

  it('keeps the top-level message too', async () => {
    const { error } = await readXero(reply(XERO_XML, 400))
    expect(error).toContain('A validation exception occurred')
  })

  it('carries the status, which is sometimes all there is', async () => {
    const { error } = await readXero(reply(XERO_XML, 400))
    expect(error).toContain('400')
  })

  it('decodes the entities rather than showing them', async () => {
    const xml = '<Response><Message>Employee &amp; pay template mismatch</Message></Response>'
    const { error } = await readXero(reply(xml, 400))
    expect(error).toContain('Employee & pay template mismatch')
    expect(error).not.toContain('&amp;')
  })
})

describe('when Xero answers in JSON', () => {
  it('passes a good reply straight through', async () => {
    const { ok, data } = await readXero(reply('{"Timesheets":[{"TimesheetID":"abc"}]}'))
    expect(ok).toBe(true)
    expect(data.Timesheets[0].TimesheetID).toBe('abc')
  })

  it('still catches an error reported with a 200', async () => {
    // Xero reports some failures with a 200 and an ErrorNumber in the body,
    // so the status alone is not enough to go on.
    const { ok, error } = await readXero(reply('{"ErrorNumber":10,"Message":"No can do"}', 200))
    expect(ok).toBe(false)
    expect(error).toContain('No can do')
  })

  it('prefers the validation detail to the generic message', async () => {
    const body = JSON.stringify({
      Message: 'A validation exception occurred',
      Elements: [{ ValidationErrors: [{ Message: 'Start date must be a Monday' }] }]
    })
    const { error } = await readXero(reply(body, 400))
    expect(error).toContain('Start date must be a Monday')
  })

  it('reads an OAuth error shape as well', async () => {
    const { error } = await readXero(reply('{"error":"invalid_grant"}', 400), 'Xero token refresh')
    expect(error).toContain('invalid_grant')
  })
})

describe('when Xero answers with neither', () => {
  it('reports a gateway page by its status', async () => {
    // An empty 502 or an HTML error page from something in between. The
    // number is the only thing anybody can act on, so it must survive.
    const { ok, error } = await readXero(reply('<html><body>Bad Gateway</body></html>', 502))
    expect(ok).toBe(false)
    expect(error).toContain('502')
  })

  it('copes with an empty body', async () => {
    const { ok, error } = await readXero(reply('', 503), 'Xero timesheet')
    expect(ok).toBe(false)
    expect(error).toBe('Xero timesheet failed (503)')
  })

  it('never returns undefined data, so callers can keep reading fields', async () => {
    const { data } = await readXero(reply('', 500))
    expect(data).toEqual({})
  })
})
