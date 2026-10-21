import { describe, expect, it } from 'vitest'
import {
  allowedActions,
  canCreateSubtask,
  canCreateTask,
  canSee,
  checkHotLimit,
  checkTransition,
  ownerNotice,
  type AllowedActions,
  type PolicyResult,
} from './policy'
import { ACTORS, author, coexecutor, makeTask, owner, responsible, stranger, type ActorName } from './testing'
import { TASK_EVENTS, type Actor, type TaskEvent } from './types'

const OK: PolicyResult = { ok: true }
const FORBIDDEN: PolicyResult = { ok: false, code: 'forbidden' }
const INVALID: PolicyResult = { ok: false, code: 'invalid_transition' }
const NO_COMMENT: PolicyResult = { ok: false, code: 'comment_required' }
const NO_DOCUMENT: PolicyResult = { ok: false, code: 'document_required' }

const NAMES = Object.keys(ACTORS) as ActorName[]

describe('canSee', () => {
  const task = makeTask()

  it.each<[ActorName, boolean]>([
    ['owner', true],
    ['author', true],
    ['responsible', true],
    ['coexecutor', true],
    ['stranger', false],
  ])('%s -> %s', (name, expected) => {
    expect(canSee(ACTORS[name], task)).toBe(expected)
  })

  it('owner sees a task without any participation', () => {
    expect(canSee(owner, makeTask({ authorId: 'x', responsibleId: 'y', coexecutorIds: [] }))).toBe(true)
  })

  describe('subtask through its parent', () => {
    const parent = makeTask({ id: 'p', authorId: 'boss', responsibleId: 'lead', coexecutorIds: ['helper'] })
    const subtask = makeTask({ id: 's', parentId: 'p', authorId: 'lead', responsibleId: 'worker', coexecutorIds: [] })
    const director = (id: string): Actor => ({ id, role: 'director' })

    it.each(['boss', 'lead', 'helper', 'worker'])('%s sees the subtask', (id) => {
      expect(canSee(director(id), subtask, { parent })).toBe(true)
    })

    it('a parent participant does not see the subtask without the parent in context', () => {
      expect(canSee(director('boss'), subtask)).toBe(false)
    })

    it('an outsider does not see the subtask', () => {
      expect(canSee(director('outsider'), subtask, { parent })).toBe(false)
    })

    it('a parent in context grants nothing for a top-level task', () => {
      const topLevel = makeTask({ authorId: 'a', responsibleId: 'b', coexecutorIds: [] })
      expect(canSee(director('boss'), topLevel, { parent })).toBe(false)
    })
  })

  describe('parent through its subtasks', () => {
    const parent = makeTask({ authorId: 'boss', responsibleId: 'lead', coexecutorIds: [] })

    it('a subtask assignee sees the parent', () => {
      expect(canSee(stranger, parent, { subtaskParticipantIds: ['worker', stranger.id] })).toBe(true)
    })

    it('not listed -> hidden', () => {
      expect(canSee(stranger, parent, { subtaskParticipantIds: ['worker'] })).toBe(false)
    })
  })
})

describe('canCreateTask', () => {
  it.each<[Actor, string, 'owner' | 'director', boolean]>([
    [owner, 'owner', 'owner', true],
    [owner, 'resp', 'director', true],
    [author, 'resp', 'director', true],
    [author, author.id, 'director', true],
    [author, 'owner', 'owner', false],
  ])('%o -> %s (%s): %s', (actor, responsibleId, role, expected) => {
    expect(canCreateTask(actor, responsibleId, role)).toBe(expected)
  })
})

describe('canCreateSubtask', () => {
  const parent = makeTask({ status: 'in_progress' })

  it.each<[ActorName, boolean]>([
    ['owner', true],
    ['author', true],
    ['responsible', true],
    ['coexecutor', false],
    ['stranger', false],
  ])('%s on an open top-level task -> %s', (name, expected) => {
    expect(canCreateSubtask(ACTORS[name], parent, 'director')).toBe(expected)
  })

  it('a director may not assign a subtask to the owner', () => {
    expect(canCreateSubtask(responsible, parent, 'owner')).toBe(false)
    expect(canCreateSubtask(author, parent, 'owner')).toBe(false)
  })

  it('the owner may assign a subtask to the owner', () => {
    expect(canCreateSubtask(owner, parent, 'owner')).toBe(true)
  })

  it('no nested subtasks, even for the owner', () => {
    const subtask = makeTask({ parentId: 'p', status: 'in_progress' })
    expect(canCreateSubtask(owner, subtask, 'director')).toBe(false)
    expect(canCreateSubtask(responsible, subtask, 'director')).toBe(false)
  })

  it('not under a done task', () => {
    const done = makeTask({ status: 'done' })
    expect(canCreateSubtask(owner, done, 'director')).toBe(false)
    expect(canCreateSubtask(responsible, done, 'director')).toBe(false)
  })

  it('allowed on a new parent', () => {
    expect(canCreateSubtask(responsible, makeTask({ status: 'new' }), 'director')).toBe(true)
  })
})

describe('checkTransition', () => {
  const comment = 'Причина'

  describe('start: new -> in_progress', () => {
    const task = makeTask({ status: 'new' })
    it.each<[ActorName, PolicyResult]>([
      ['owner', OK],
      ['author', OK],
      ['responsible', OK],
      ['coexecutor', FORBIDDEN],
      ['stranger', FORBIDDEN],
    ])('%s', (name, expected) => {
      expect(checkTransition(ACTORS[name], task, 'in_progress')).toEqual(expected)
    })
  })

  describe.each(['new', 'in_progress'] as const)('complete: %s -> done', (from) => {
    const task = makeTask({ status: from })
    it.each<[ActorName, PolicyResult]>([
      ['owner', OK],
      ['author', OK],
      ['responsible', OK],
      ['coexecutor', FORBIDDEN],
      ['stranger', FORBIDDEN],
    ])('%s', (name, expected) => {
      expect(checkTransition(ACTORS[name], task, 'done')).toEqual(expected)
    })
  })

  describe('document required', () => {
    const task = makeTask({ status: 'in_progress', requiresDocument: true })

    it.each<ActorName>(['owner', 'author', 'responsible'])('%s cannot complete without an attachment', (name) => {
      expect(checkTransition(ACTORS[name], task, 'done')).toEqual(NO_DOCUMENT)
    })

    it('completes once something is attached', () => {
      expect(checkTransition(responsible, { ...task, attachmentCount: 1 }, 'done')).toEqual(OK)
    })

    it('a cancel does not need the document', () => {
      expect(checkTransition(author, task, 'done', { cancelled: true, comment })).toEqual(OK)
    })

    it('forbidden wins over document_required', () => {
      expect(checkTransition(coexecutor, task, 'done')).toEqual(FORBIDDEN)
    })
  })

  describe.each(['new', 'in_progress'] as const)('cancel from %s', (from) => {
    const task = makeTask({ status: from })
    it.each<[ActorName, PolicyResult]>([
      ['owner', OK],
      ['author', OK],
      ['responsible', FORBIDDEN],
      ['coexecutor', FORBIDDEN],
      ['stranger', FORBIDDEN],
    ])('%s with a comment', (name, expected) => {
      expect(checkTransition(ACTORS[name], task, 'done', { cancelled: true, comment })).toEqual(expected)
    })

    it.each([undefined, '', '   '])('comment %j is required', (empty) => {
      expect(checkTransition(author, task, 'done', { cancelled: true, comment: empty })).toEqual(NO_COMMENT)
      expect(checkTransition(owner, task, 'done', { cancelled: true, comment: empty })).toEqual(NO_COMMENT)
    })
  })

  it('cannot cancel a done task', () => {
    expect(checkTransition(owner, makeTask({ status: 'done' }), 'done', { cancelled: true, comment })).toEqual(INVALID)
  })

  it('cancelled flag only goes with done', () => {
    expect(checkTransition(owner, makeTask(), 'in_progress', { cancelled: true, comment })).toEqual(INVALID)
  })

  describe('reopen: done -> in_progress', () => {
    const task = makeTask({ status: 'done', completedAt: '2026-11-01T10:00:00.000Z' })
    it.each<[ActorName, PolicyResult]>([
      ['owner', OK],
      ['author', OK],
      ['responsible', FORBIDDEN],
      ['coexecutor', FORBIDDEN],
      ['stranger', FORBIDDEN],
    ])('%s with a comment', (name, expected) => {
      expect(checkTransition(ACTORS[name], task, 'in_progress', { comment })).toEqual(expected)
    })

    it.each([undefined, '', '  \n '])('comment %j is required', (empty) => {
      expect(checkTransition(author, task, 'in_progress', { comment: empty })).toEqual(NO_COMMENT)
      expect(checkTransition(owner, task, 'in_progress', { comment: empty })).toEqual(NO_COMMENT)
    })

    it('a cancelled task reopens the same way', () => {
      expect(checkTransition(author, { ...task, cancelled: true }, 'in_progress', { comment })).toEqual(OK)
    })
  })

  describe('invalid transitions', () => {
    it.each<[string, string]>([
      ['new', 'new'],
      ['in_progress', 'in_progress'],
      ['done', 'done'],
      ['in_progress', 'new'],
      ['done', 'new'],
    ])('%s -> %s', (from, to) => {
      for (const name of NAMES) {
        const task = makeTask({ status: from as 'new' })
        expect(checkTransition(ACTORS[name], task, to as 'new', { comment })).toEqual(INVALID)
      }
    })
  })

  describe('subtask: its assignee or its creator completes it', () => {
    // Created by the parent's responsible ('resp'), assigned to 'worker'.
    const worker: Actor = { id: 'worker', role: 'director' }
    const subtask = makeTask({ id: 's', parentId: 't1', authorId: responsible.id, responsibleId: worker.id, coexecutorIds: [], status: 'in_progress' })

    it.each<[Actor, PolicyResult]>([
      [worker, OK],
      [responsible, OK],
      [owner, OK],
      [author, FORBIDDEN],
    ])('%o', (actor, expected) => {
      expect(checkTransition(actor, subtask, 'done')).toEqual(expected)
    })
  })
})

describe('allowedActions', () => {
  const none: AllowedActions = {
    start: false,
    complete: false,
    cancel: false,
    reopen: false,
    edit: false,
    changeDue: false,
    requestDueChange: false,
    decideDueRequest: false,
    setHot: false,
    setPriority: false,
    manageCoexecutors: false,
    addSubtask: false,
    comment: false,
  }
  const actions = (keys: (keyof AllowedActions)[]): AllowedActions =>
    keys.reduce((acc, key) => ({ ...acc, [key]: true }), none)

  describe('new task, medium priority', () => {
    const task = makeTask({ status: 'new' })
    it.each<[ActorName, AllowedActions]>([
      ['owner', actions(['start', 'complete', 'cancel', 'edit', 'changeDue', 'decideDueRequest', 'setHot', 'setPriority', 'manageCoexecutors', 'addSubtask', 'comment'])],
      ['author', actions(['start', 'complete', 'cancel', 'edit', 'changeDue', 'decideDueRequest', 'setPriority', 'manageCoexecutors', 'addSubtask', 'comment'])],
      ['responsible', actions(['start', 'complete', 'requestDueChange', 'manageCoexecutors', 'addSubtask', 'comment'])],
      ['coexecutor', actions(['comment'])],
      ['stranger', none],
    ])('%s', (name, expected) => {
      expect(allowedActions(ACTORS[name], task)).toEqual(expected)
    })
  })

  describe('in progress', () => {
    const task = makeTask({ status: 'in_progress' })
    it.each<[ActorName, AllowedActions]>([
      ['owner', actions(['complete', 'cancel', 'edit', 'changeDue', 'decideDueRequest', 'setHot', 'setPriority', 'manageCoexecutors', 'addSubtask', 'comment'])],
      ['author', actions(['complete', 'cancel', 'edit', 'changeDue', 'decideDueRequest', 'setPriority', 'manageCoexecutors', 'addSubtask', 'comment'])],
      ['responsible', actions(['complete', 'requestDueChange', 'manageCoexecutors', 'addSubtask', 'comment'])],
      ['coexecutor', actions(['comment'])],
      ['stranger', none],
    ])('%s', (name, expected) => {
      expect(allowedActions(ACTORS[name], task)).toEqual(expected)
    })
  })

  describe('done: chat is read-only, only reopen remains', () => {
    const task = makeTask({ status: 'done' })
    it.each<[ActorName, AllowedActions]>([
      ['owner', actions(['reopen'])],
      ['author', actions(['reopen'])],
      ['responsible', none],
      ['coexecutor', none],
      ['stranger', none],
    ])('%s', (name, expected) => {
      expect(allowedActions(ACTORS[name], task)).toEqual(expected)
    })
  })

  describe('hot task: due and priority belong to the owner', () => {
    const task = makeTask({ status: 'in_progress', priority: 'hot' })

    it.each<[ActorName, boolean]>([
      ['owner', true],
      ['author', false],
      ['responsible', false],
      ['coexecutor', false],
      ['stranger', false],
    ])('%s changeDue / setPriority / setHot -> %s', (name, expected) => {
      const result = allowedActions(ACTORS[name], task)
      expect(result.changeDue).toBe(expected)
      expect(result.setPriority).toBe(expected)
      expect(result.setHot).toBe(expected)
    })

    it('the responsible cannot request a due change on a hot task', () => {
      expect(allowedActions(responsible, task).requestDueChange).toBe(false)
    })

    it('the author can still edit other fields and decide requests', () => {
      const result = allowedActions(author, task)
      expect(result.edit).toBe(true)
      expect(result.decideDueRequest).toBe(true)
    })
  })

  describe('requestDueChange', () => {
    it('only the responsible', () => {
      const task = makeTask({ status: 'in_progress' })
      expect(NAMES.filter((name) => allowedActions(ACTORS[name], task).requestDueChange)).toEqual(['responsible'])
    })

    it('not when the responsible is also the author', () => {
      const task = makeTask({ authorId: responsible.id })
      expect(allowedActions(responsible, task).requestDueChange).toBe(false)
      expect(allowedActions(responsible, task).changeDue).toBe(true)
    })

    it('not on a done task', () => {
      expect(allowedActions(responsible, makeTask({ status: 'done' })).requestDueChange).toBe(false)
    })

    it.each(['low', 'medium', 'high'] as const)('allowed with priority %s', (priority) => {
      expect(allowedActions(responsible, makeTask({ priority })).requestDueChange).toBe(true)
    })
  })

  describe('addSubtask', () => {
    it('never on a subtask', () => {
      const subtask = makeTask({ parentId: 'p' })
      for (const name of NAMES) expect(allowedActions(ACTORS[name], subtask).addSubtask).toBe(false)
    })
  })

  describe('comment through visibility context', () => {
    const parent = makeTask({ id: 'p', authorId: 'boss', responsibleId: stranger.id, coexecutorIds: [] })
    const subtask = makeTask({ id: 's', parentId: 'p', authorId: 'boss', responsibleId: 'worker', coexecutorIds: [] })

    it('a parent participant can comment in the subtask but do nothing else', () => {
      expect(allowedActions(stranger, subtask, { parent })).toEqual(actions(['comment']))
    })

    it('a subtask assignee can comment in the parent', () => {
      const top = makeTask({ authorId: 'boss', responsibleId: 'lead', coexecutorIds: [] })
      expect(allowedActions(stranger, top, { subtaskParticipantIds: [stranger.id] })).toEqual(actions(['comment']))
    })
  })

  it('flags agree with checkTransition for permission', () => {
    for (const status of ['new', 'in_progress', 'done'] as const) {
      const task = makeTask({ status })
      for (const name of NAMES) {
        const actor = ACTORS[name]
        const flags = allowedActions(actor, task)
        expect(flags.start).toBe(checkTransition(actor, task, 'in_progress').ok && status === 'new')
        expect(flags.complete).toBe(checkTransition(actor, task, 'done').ok)
        expect(flags.cancel).toBe(checkTransition(actor, task, 'done', { cancelled: true, comment: 'x' }).ok)
        expect(flags.reopen).toBe(checkTransition(actor, task, 'in_progress', { comment: 'x' }).ok && status === 'done')
      }
    }
  })
})

describe('checkHotLimit', () => {
  it('no open hot tasks -> ok', () => {
    expect(checkHotLimit([], 't1')).toEqual({ ok: true })
  })

  it('setting hot on the already hot task again is fine', () => {
    expect(checkHotLimit(['t1'], 't1')).toEqual({ ok: true })
  })

  it('another open hot task conflicts', () => {
    expect(checkHotLimit(['t2'], 't1')).toEqual({ ok: false, code: 'hot_limit', conflictingTaskId: 't2' })
  })

  it('reports the other task, not the same one', () => {
    expect(checkHotLimit(['t1', 't2'], 't1')).toEqual({ ok: false, code: 'hot_limit', conflictingTaskId: 't2' })
  })
})

describe('ownerNotice', () => {
  const expected: Record<TaskEvent, 'immediate' | 'digest' | null> = {
    task_reopened: 'immediate',
    task_overdue: 'immediate',
    hot_set: 'immediate',
    task_created: 'digest',
    task_completed: 'digest',
    task_cancelled: 'digest',
    due_changed: 'digest',
    due_change_requested: 'digest',
    task_started: null,
    due_change_decided: null,
    due_reminder: null,
  }

  it.each(TASK_EVENTS)('%s by a director', (event) => {
    expect(ownerNotice(event, author)).toBe(expected[event])
  })

  it.each(TASK_EVENTS)('%s by the system', (event) => {
    expect(ownerNotice(event, null)).toBe(expected[event])
  })

  it.each(TASK_EVENTS)('%s by the owner -> nothing', (event) => {
    expect(ownerNotice(event, owner)).toBeNull()
  })
})
