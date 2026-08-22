import '@testing-library/jest-dom/vitest'

// jsdom has no clipboard by default and the plan view offers a copy action.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.resolve() },
    configurable: true
  })
}
