import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// A test that expires quietly is worse than no test.
//
// `ClinicalPlan.live.test.jsx` called `useFakeTimers` but never `setSystemTime`,
// so the clock stayed real while its bookings were fixed in August 2026. The
// plan opens on the current week, so those bookings were in it during August and
// nowhere near it afterwards: thirteen assertions that were green when written
// and went red on a date rather than on a change. Found a month later, while
// looking for something else, and read at first as a regression that was not
// there.
//
// The rot only bites screens that resolve "now" themselves. A module handed a
// date — `weekWindowFor('2026-08-24')` — is immune however long it sits.

const ROOT = process.cwd()

/** Screens that decide which day or week to show from the clock. */
const DATE_DRIVEN = ['ClinicalPlan', 'TodayView', 'Cases']

function testFiles(dir) {
  const found = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) found.push(...testFiles(path))
    else if (/\.test\.jsx?$/.test(entry.name)) found.push(path)
  }
  return found
}

describe('tests that render a date-driven screen', () => {
  it('pin the clock, so they cannot pass in one month and fail in the next', () => {
    const unpinned = []
    for (const path of testFiles('src')) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      const rendersDateDriven = DATE_DRIVEN.some(name =>
        new RegExp(`(?:import\\s+${name}\\b|<${name}[\\s/>])`).test(source))
      if (!rendersDateDriven) continue
      // Either pins the clock outright, or drives the whole app through a
      // harness that does.
      if (!/setSystemTime/.test(source)) unpinned.push(path)
    }
    expect(unpinned, 'render a date-driven screen against the real clock').toEqual([])
  })
})
