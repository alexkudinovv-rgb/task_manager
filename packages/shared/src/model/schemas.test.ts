import { describe, expect, it } from 'vitest'
import { CreateTaskInput, DueChangeRequestInput, TransitionInput, UpdateTaskInput } from './schemas'

const base = { title: 'Сверить акты', responsibleId: 'u1', dueDate: '2026-11-10' }

describe('CreateTaskInput', () => {
  it('fills defaults', () => {
    expect(CreateTaskInput.parse(base)).toEqual({
      ...base,
      description: '',
      coexecutorIds: [],
      priority: 'medium',
      requiresDocument: false,
    })
  })

  it('keeps optional fields', () => {
    const input = { ...base, dueTime: '09:30', startDate: '2026-11-01', parentId: 'p1', priority: 'hot' }
    expect(CreateTaskInput.parse(input)).toMatchObject(input)
  })

  it.each([
    ['empty title', { ...base, title: '' }],
    ['blank title', { ...base, title: '   ' }],
    ['long title', { ...base, title: 'x'.repeat(201) }],
    ['long description', { ...base, description: 'x'.repeat(10001) }],
    ['no responsible', { ...base, responsibleId: '' }],
    ['date format', { ...base, dueDate: '10.11.2026' }],
    ['impossible date', { ...base, dueDate: '2026-02-30' }],
    ['time 24:00', { ...base, dueTime: '24:00' }],
    ['time without minutes', { ...base, dueTime: '9' }],
    ['unknown priority', { ...base, priority: 'urgent' }],
    ['no due date', { title: 'x', responsibleId: 'u1' }],
  ])('rejects %s', (_, input) => {
    expect(CreateTaskInput.safeParse(input).success).toBe(false)
  })

  it('accepts a 200-char title and a leap day', () => {
    expect(CreateTaskInput.safeParse({ ...base, title: 'x'.repeat(200), dueDate: '2028-02-29' }).success).toBe(true)
  })
})

describe('UpdateTaskInput', () => {
  it('does not invent defaults for absent fields', () => {
    expect(UpdateTaskInput.parse({ title: 'Новое' })).toEqual({ title: 'Новое' })
  })

  it('null clears dueTime and startDate', () => {
    expect(UpdateTaskInput.parse({ dueTime: null, startDate: null })).toEqual({ dueTime: null, startDate: null })
  })

  it('validates what is present', () => {
    expect(UpdateTaskInput.safeParse({ dueDate: '2026-13-01' }).success).toBe(false)
    expect(UpdateTaskInput.safeParse({ title: '' }).success).toBe(false)
  })
})

describe('TransitionInput', () => {
  it('accepts a known status', () => {
    expect(TransitionInput.parse({ to: 'done', cancelled: true, comment: 'Не нужна' })).toEqual({
      to: 'done',
      cancelled: true,
      comment: 'Не нужна',
    })
  })

  it('rejects an unknown status', () => {
    expect(TransitionInput.safeParse({ to: 'archived' }).success).toBe(false)
  })
})

describe('DueChangeRequestInput', () => {
  it('needs a reason', () => {
    expect(DueChangeRequestInput.safeParse({ dueDate: '2026-11-12' }).success).toBe(false)
    expect(DueChangeRequestInput.safeParse({ dueDate: '2026-11-12', reason: '  ' }).success).toBe(false)
    expect(DueChangeRequestInput.safeParse({ dueDate: '2026-11-12', reason: 'x'.repeat(1001) }).success).toBe(false)
  })

  it('accepts a date, optional time and reason', () => {
    expect(DueChangeRequestInput.parse({ dueDate: '2026-11-12', dueTime: '12:00', reason: 'Ждём поставщика' })).toEqual({
      dueDate: '2026-11-12',
      dueTime: '12:00',
      reason: 'Ждём поставщика',
    })
  })
})
