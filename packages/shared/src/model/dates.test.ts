import { describe, expect, it } from 'vitest'
import { isOverdue, moscowParts, reminderOffsets } from './dates'
import { makeTask } from './testing'

const at = (iso: string) => new Date(iso)

describe('moscowParts', () => {
  it('shifts UTC by +3 hours across midnight', () => {
    expect(moscowParts(at('2026-11-10T20:59:00Z'))).toEqual({ date: '2026-11-10', time: '23:59:00.000' })
    expect(moscowParts(at('2026-11-10T21:01:00Z'))).toEqual({ date: '2026-11-11', time: '00:01:00.000' })
  })
})

describe('isOverdue', () => {
  describe('date only (due 2026-11-10)', () => {
    const task = makeTask({ dueDate: '2026-11-10', dueTime: null, status: 'in_progress' })

    it.each<[string, boolean]>([
      ['2026-11-09T20:59:00Z', false], // 23:59 Moscow, the day before
      ['2026-11-09T21:01:00Z', false], // 00:01 Moscow on the due day
      ['2026-11-10T12:00:00Z', false],
      ['2026-11-10T20:59:00Z', false], // 23:59 Moscow on the due day
      ['2026-11-10T21:00:00Z', true], // 00:00 Moscow the next day
      ['2026-11-10T21:01:00Z', true],
      ['2026-12-01T00:00:00Z', true],
    ])('now %s -> %s', (now, expected) => {
      expect(isOverdue(task, at(now))).toBe(expected)
    })
  })

  describe('with dueTime 18:00 Moscow (15:00 UTC)', () => {
    const task = makeTask({ dueDate: '2026-11-10', dueTime: '18:00', status: 'new' })

    it.each<[string, boolean]>([
      ['2026-11-09T16:00:00Z', false], // the day before, later in the day
      ['2026-11-10T14:59:00Z', false],
      ['2026-11-10T15:00:00Z', false], // exactly at the deadline
      ['2026-11-10T15:00:01Z', true],
      ['2026-11-10T15:01:00Z', true],
      ['2026-11-10T22:00:00Z', true], // next Moscow day
    ])('now %s -> %s', (now, expected) => {
      expect(isOverdue(task, at(now))).toBe(expected)
    })
  })

  it('dueTime 23:59 near Moscow midnight', () => {
    const task = makeTask({ dueDate: '2026-11-10', dueTime: '23:59' })
    expect(isOverdue(task, at('2026-11-10T20:58:59Z'))).toBe(false)
    expect(isOverdue(task, at('2026-11-10T20:59:30Z'))).toBe(true)
  })

  it('a done task is never overdue', () => {
    const task = makeTask({ dueDate: '2026-11-10', status: 'done', cancelled: false })
    expect(isOverdue(task, at('2027-01-01T00:00:00Z'))).toBe(false)
  })
})

describe('reminderOffsets', () => {
  it('a week as 5 working days, then 1 day, then at overdue', () => {
    expect(reminderOffsets.beforeDays.map((r) => r.days)).toEqual([5, 1])
    expect(reminderOffsets.beforeDays[0]?.workingDaysOnly).toBe(true)
    expect(reminderOffsets.atOverdue).toBe(true)
  })
})
