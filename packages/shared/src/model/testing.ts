import type { Actor, Task } from './types'

// Test fixtures; not exported from the model entry point.

export const owner: Actor = { id: 'owner', role: 'owner' }
export const author: Actor = { id: 'author', role: 'director' }
export const responsible: Actor = { id: 'resp', role: 'director' }
export const coexecutor: Actor = { id: 'coex', role: 'director' }
export const stranger: Actor = { id: 'stranger', role: 'director' }

export const ACTORS = { owner, author, responsible, coexecutor, stranger }
export type ActorName = keyof typeof ACTORS

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    parentId: null,
    title: 'Подготовить отчёт',
    description: '',
    authorId: author.id,
    responsibleId: responsible.id,
    coexecutorIds: [coexecutor.id],
    status: 'new',
    priority: 'medium',
    dueDate: '2026-11-10',
    dueTime: null,
    startDate: null,
    requiresDocument: false,
    cancelled: false,
    createdAt: '2026-10-20T09:00:00.000Z',
    completedAt: null,
    attachmentCount: 0,
    checklist: { done: 0, total: 0 },
    subtasks: { done: 0, total: 0 },
    commentCount: 0,
    ...overrides,
  }
}
