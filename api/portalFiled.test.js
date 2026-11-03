import { describe, it, expect } from 'vitest'
import { filedEntries, isPortalFiled } from './usage/agent.js'

// Filed usage is shown from the portal's own record of what it filed, laid out
// as the Dropbox folders are, and nothing else under the usage root can be
// opened. Invented names only.
const ROOT = '/ALL SURGEON USAGE/SPINE'
const filed = [
  { path: `${ROOT}/Surgeon A/November 2026/Testcase_01112026_A_ACDF_CLV`, files: ['usage.xlsx', 'scan.pdf'], at: '2026-11-01T01:00:00Z' },
  { path: `${ROOT}/Surgeon A/October 2026/Sample_20102026_A_PLIF_RHH`, files: ['usage.xlsx'], at: '2026-10-20T01:00:00Z' },
  { path: `${ROOT}/Surgeon B/November 2026/Dummy_02112026_B_TLIF_CLV`, files: ['usage.xlsx'], at: '2026-11-02T01:00:00Z' },
]

describe('filed usage tree', () => {
  it('lists surgeons at the root', () => {
    expect(filedEntries(filed, ROOT).map(e => [e.kind, e.name])).toEqual([['folder', 'Surgeon A'], ['folder', 'Surgeon B']])
  })
  it('lists months under a surgeon', () => {
    const months = filedEntries(filed, `${ROOT}/Surgeon A`)
    expect(months.map(e => e.name)).toEqual(['November 2026', 'October 2026'])
    expect(months[0].path).toBe(`${ROOT}/Surgeon A/November 2026`)
  })
  it('lists the files in a case folder', () => {
    const files = filedEntries(filed, `${ROOT}/Surgeon A/November 2026/Testcase_01112026_A_ACDF_CLV`)
    expect(files.map(e => [e.kind, e.name])).toEqual([['file', 'scan.pdf'], ['file', 'usage.xlsx']])
  })
  it('opens only files the portal filed', () => {
    expect(isPortalFiled(filed, `${ROOT}/Surgeon A/November 2026/Testcase_01112026_A_ACDF_CLV/scan.pdf`)).toBe(true)
    expect(isPortalFiled(filed, `${ROOT}/Surgeon A/November 2026/Testcase_01112026_A_ACDF_CLV/other.pdf`)).toBe(false)
    expect(isPortalFiled(filed, `${ROOT}/Surgeon C/2019/Old_case/usage.xlsx`)).toBe(false)
  })
})
