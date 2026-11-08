import { describe, it, expect } from 'vitest'
import { nameForDistributor } from './_usageCase.js'

// Toni, 9 Nov 2026: the Shoreline usage went to Device titled "…_Boost-UF_RHH".
// Each distributor's email is named for what is in their own sheet.
describe("a usage email is named for the distributor's own items", () => {
  const shoreline = [{ productName: 'Shoreline ACS cage 6mm', referenceCode: 'SL-123' }]
  const boost = [{ productName: 'BOOST Ultrafibre', referenceCode: 'ABT-AB-05' }]

  it('Shoreline to Device says Shoreline, not Boost', () => {
    expect(nameForDistributor('Testcase_09112026_Fowler_ACDF+Boost-UF_RHH', 'C5/6 ACDF with Boost', shoreline))
      .toBe('Testcase_09112026_Fowler_ACDF+Shoreline_RHH')
  })
  it('Boost to its desk keeps Boost UF', () => {
    expect(nameForDistributor('Testcase_09112026_Fowler_ACDF+Boost-UF_RHH', 'C5/6 ACDF with Boost', boost))
      .toBe('Testcase_09112026_Fowler_ACDF+Boost-UF_RHH')
  })
  it('when the folder only said Boost, the Shoreline email still says Shoreline', () => {
    expect(nameForDistributor('Testcase_09112026_Fowler_Boost-UF_RHH', '', shoreline))
      .toBe('Testcase_09112026_Fowler_Shoreline_RHH')
  })
  it('keeps a second-case suffix, and leaves an odd name alone', () => {
    expect(nameForDistributor('Testcase_09112026_Fowler_Boost-UF_RHH_2', 'ACDF', shoreline))
      .toBe('Testcase_09112026_Fowler_ACDF+Shoreline_RHH_2')
    expect(nameForDistributor('Odd name', 'ACDF', shoreline)).toBe('Odd name')
  })
})
