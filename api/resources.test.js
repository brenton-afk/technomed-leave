import { describe, it, expect } from 'vitest'
import { slotOf, systemsForFile, resourcesBySystem, carriedSystems, openablePath } from './_resources.js'

// Brent, 12 Nov 2026: Resources holds, per system we carry, the ARTG
// certificate, the full surgical technique, the rebate codes and prices and
// the tray list. Names below are as filed in Dropbox.
const f = (path, distributor, modified = '2025-01-01') => ({ path, name: path.split('/').pop(), distributor, slot: slotOf(path.split('/').pop()), modified })
const catalogue = [
  f('/Distributors/E4 Surgical/Dakota ACDF/ARTG 317596 (Precision Cervical Interbody) Dakota.pdf', 'e4'),
  f('/Distributors/E4 Surgical/Dakota ACDF/Dakota_Surgical Technique.pdf', 'e4'),
  f('/Distributors/E4 Surgical/E4 Global ALIF/ARTG 323520 (GB lumbar cage including Standalone).pdf', 'e4'),
  f('/Distributors/Device Technologies/Mariner/SeaSpine Mariner Outrigger Surgical Technique 2021_EML.pdf', 'device'),
  f('/Distributors/Device Technologies/Mariner/Mariner/Compressed SeaSpine Mariner MIS Surgical Technique 2021 (1).pdf', 'device'),
  f('/Distributors/Device Technologies/SHORELINE SYSTEM/Shoreline Rebate Codes/Shoreline Rebate Codes 2021.pdf', 'device'),
  f('/Distributors/Nuvasive/Reline/RelineSystem ARTG.pdf', 'globus'),
  f('/Distributors/Nuvasive/Reline/Reline Open-RMM Rebate codes with GTIN.xlsx', 'globus'),
  f('/Distributors/Signus/DIPLOMAT/Diplomat Rebate Codes/Signus DIPLOMAT Implants Rebate Codes- Word.docx', 'signus'),
  f('/Distributors/Signus/ATHLET/athlet surgical technique.pdf', 'signus'),
  f('/Distributors/Signus/ascot surgical technique.pdf', 'signus')
]

describe('reading what a file is', () => {
  it('knows an ARTG, a technique and a rebate list by name, and nothing else', () => {
    expect(slotOf('ARTG 473166.pdf')).toBe('artg')
    expect(slotOf('Dakota_Surgical Technique.pdf')).toBe('technique')
    expect(slotOf('Cervical Rebates.xlsx')).toBe('rebate')
    expect(slotOf('Diplomat brochure.pdf')).toBe('')
    expect(slotOf('Smartguide.pdf')).toBe('')
  })
  it('gives a file to the most precisely named system', () => {
    const device = carriedSystems().filter(s => s.distributor === 'device')
    expect(systemsForFile('/Distributors/Device Technologies/Mariner/SeaSpine Mariner Outrigger Surgical Technique 2021_EML.pdf', device)).toEqual(['Mariner Outrigger'])
    expect(systemsForFile('/Distributors/Device Technologies/Mariner/Mariner/Compressed SeaSpine Mariner MIS Surgical Technique 2021 (1).pdf', device)).toEqual(['Mariner'])
    const globus = carriedSystems().filter(s => s.distributor === 'globus')
    expect(systemsForFile('/Distributors/Nuvasive/Reline/RelineSystem ARTG.pdf', globus)).toEqual(['REline'])
  })
})

describe('the Resources tab', () => {
  const kits = [{ id: 'dakota-clv', name: 'Dakota', system: 'Dakota', trayCount: 3 }, { id: 'ascot-rhh', name: 'Ascot', system: 'Ascot', trayCount: 0 }]
  const by = Object.fromEntries(resourcesBySystem({ catalogue, kits }).map(s => [s.system, s]))
  it('lists only the systems we carry', () => {
    expect(by.Cascadia).toBeUndefined()
    expect(by.Diplomat.distributorName).toBe('Signus')
  })
  it('fills each slot from the system\'s own folder, and the tray list from the kit room', () => {
    expect(by.Dakota.slots.artg.file.name).toMatch(/ARTG 317596/)
    expect(by.Dakota.slots.technique.file.name).toBe('Dakota_Surgical Technique.pdf')
    expect(by.Dakota.trays).toEqual([{ id: 'dakota-clv', name: 'Dakota', trays: 3 }])
    expect(by.Ascot.trays).toEqual([])
    expect(by['Global BMD ALIF'].slots.artg.file.name).toMatch(/323520/)
    expect(by.Diplomat.slots.rebate.file.name).toMatch(/DIPLOMAT Implants Rebate/)
    expect(by.REline.slots.rebate.file.name).toMatch(/Rebate codes with GTIN/)
    expect(by.Diplomat.slots.artg.file).toBe(null)
  })
  it('honours a person\'s pick, or their "there is none"', () => {
    const picks = { Dakota: { technique: 'none', artg: '/Distributors/E4 Surgical/E4 Global ALIF/ARTG 323520 (GB lumbar cage including Standalone).pdf' } }
    const d = resourcesBySystem({ catalogue, picks }).find(s => s.system === 'Dakota')
    expect(d.slots.technique).toMatchObject({ file: null, none: true })
    expect(d.slots.artg.file.name).toMatch(/323520/)
    expect(d.slots.artg.others.map(o => o.name)).toEqual(['ARTG 317596 (Precision Cervical Interbody) Dakota.pdf'])
  })
  it('opens only files from the reference folders', () => {
    expect(openablePath(catalogue[0].path, catalogue)).toBe(true)
    expect(openablePath('/ALL SURGEON USAGE/SPINE/x.pdf', catalogue)).toBe(false)
  })
})
