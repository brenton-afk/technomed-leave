import { describe, it, expect, beforeEach, vi } from 'vitest'
import { saveSession } from './App.jsx'
import { trimCachedPlans } from './clinicalPlan/provider.js'

// "The app is suddenly asking me to log in every time again." The saved weeks
// had filled the phone's storage, so saving the sign-in failed silently.

beforeEach(() => localStorage.clear())

describe('staying signed in', () => {
  it('saves the sign-in even when saved weeks have filled the storage', () => {
    for (let i = 0; i < 5; i++) localStorage.setItem(`tm_clinical_plan:b1:2026-10-0${i}`, JSON.stringify({ cachedAt: i }))
    const real = Storage.prototype.setItem
    let full = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (full && key === 'tm_user') { full = false; throw new DOMException('full', 'QuotaExceededError') }
      return real.call(this, key, value)
    })
    saveSession({ email: 'ben@technomed.com.au', token: 't' })
    expect(JSON.parse(localStorage.getItem('tm_user')).email).toBe('ben@technomed.com.au')
    expect(localStorage.getItem('tm_login_time')).toBeTruthy()
    expect(Object.keys(localStorage).filter(k => k.startsWith('tm_clinical_plan:'))).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it('keeps only the most recently viewed weeks', () => {
    for (let i = 0; i < 12; i++) localStorage.setItem(`tm_clinical_plan:b1:w${i}`, JSON.stringify({ cachedAt: i }))
    localStorage.setItem('tm_user', '{"email":"x"}')
    trimCachedPlans(8)
    const left = Object.keys(localStorage).filter(k => k.startsWith('tm_clinical_plan:'))
    expect(left).toHaveLength(8)
    expect(left).not.toContain('tm_clinical_plan:b1:w0')
    expect(localStorage.getItem('tm_user')).toBe('{"email":"x"}')
  })
})
