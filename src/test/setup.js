import '@testing-library/jest-dom/vitest'

// A test file may ask for the plain node environment (`@vitest-environment
// node` — Label Studio's Fabric tests); there is no window there to stub.
if (typeof window !== 'undefined') {
  // jsdom has no clipboard by default and the plan view offers a copy action.
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true
    })
  }

  // jsdom does not implement scrollTo, and navigating between tabs calls it.
  if (!window.scrollTo || !window.scrollTo._stubbed) {
    window.scrollTo = Object.assign(() => {}, { _stubbed: true })
  }
}
