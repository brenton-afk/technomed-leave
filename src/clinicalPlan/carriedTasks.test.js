import { describe, it, expect } from 'vitest'
import { carriedTasks, withCarried } from './tasks.js'

// Toni and Brent, 10 Nov 2026: a day job left unticked comes forward to today.
const ev = (id, date, extra = '') => ({
  id, summary: 'TASK: Move Dakota from TM Office to Calvary',
  description: `Task: Move a kit\nItem: Dakota\nFrom: TM Office\nTo: Calvary\n${extra}`,
  start: { date }
})

describe('jobs that were not done carry over', () => {
  const TODAY = '2026-11-10'

  it('brings forward unticked jobs from earlier days, oldest first', () => {
    const out = carriedTasks([ev('b', '2026-11-06'), ev('a', '2026-11-03')], TODAY)
    expect(out.map(t => t.id)).toEqual(['a', 'b'])
    expect(out[0]).toMatchObject({ carried: true, date: '2026-11-03', thing: 'Dakota' })
  })

  it('leaves out what was ticked, what is not a task, and today or later', () => {
    const out = carriedTasks([
      ev('done', '2026-11-05', 'Done by Toni on 5/11/2026'),
      { id: 'case', summary: 'Sample DAKOTA - Ibbett', description: '', start: { date: '2026-11-05' } },
      ev('today', TODAY), ev('later', '2026-11-12'),
      { ...ev('timed', '2026-11-04'), start: { dateTime: '2026-11-04T09:00:00+11:00' } }
    ], TODAY)
    expect(out.map(t => t.id)).toEqual(['timed'])
  })

  it('puts them in front of today’s own jobs, each once', () => {
    const carried = carriedTasks([ev('old', '2026-11-04')], TODAY)
    const merged = withCarried([{ id: 'mine', what: 'Restock' }, { id: 'old', what: 'dup' }], carried)
    expect(merged.map(t => t.id)).toEqual(['mine', 'old'])
    expect(withCarried([{ id: 'mine' }], carried).map(t => t.id)).toEqual(['old', 'mine'])
  })
})
