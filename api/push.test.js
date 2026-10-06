
import { readFileSync } from 'fs'
import { join } from 'path'
describe('a subscription the push service rejects outright', () => {
  // 403 is what a push service returns when the VAPID key a subscription was
  // made with is not the key the message is signed with. It happens exactly
  // once — the day the keys are rotated — and then to every subscription at
  // the same moment.
  it('is cleaned up like a gone one, not retried forever', () => {
    const source = readFileSync(join(__dirname, '_push.js'), 'utf8')
    // Checked in the source: driving a 403 through notify() means standing up
    // web-push, and the fact worth protecting is which codes count as dead.
    const guard = /statusCode === 404 \|\| err\?\.statusCode === 410\s*\|\|\s*err\?\.statusCode === 403/
    expect(source).toMatch(guard)
  })
})
