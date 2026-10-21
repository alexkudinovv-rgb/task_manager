import { describe, expect, it } from 'vitest'
import { progress } from './progress'
import { makeTask } from './testing'

describe('progress', () => {
  it('nothing to count -> ratio 0', () => {
    expect(progress(makeTask())).toEqual({ done: 0, total: 0, ratio: 0 })
  })

  it('sums subtasks and checklist items', () => {
    const task = makeTask({ subtasks: { done: 1, total: 2 }, checklist: { done: 2, total: 6 } })
    expect(progress(task)).toEqual({ done: 3, total: 8, ratio: 3 / 8 })
  })

  it('checklist only', () => {
    expect(progress(makeTask({ checklist: { done: 4, total: 4 } })).ratio).toBe(1)
  })
})
