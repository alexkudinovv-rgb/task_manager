import { ownerNotice, TASK_EVENTS, type Actor, type TaskEvent } from '@car-city/shared/model'
import { sql } from 'drizzle-orm'
import { notifications, taskEvents } from '../../db/schema'
import { ownerId, type Conn } from './repository'

/**
 * History-only events for changes the shared TaskEvent list has no name for.
 * They never notify anyone.
 */
export type LocalTaskEvent =
  | 'task_updated'
  | 'coexecutors_changed'
  | 'checklist_item_added'
  | 'checklist_item_updated'
  | 'checklist_item_removed'

export type EventType = TaskEvent | LocalTaskEvent

const isTaskEvent = (type: EventType): type is TaskEvent => (TASK_EVENTS as readonly string[]).includes(type)

/** Writes task_events (and the owner's notification rows) inside the caller's transaction. */
export class EventLog {
  private owner: Promise<string | null> | undefined

  constructor(
    private readonly tx: Conn,
    private readonly actor: Actor,
  ) {}

  async record(task: { id: string; title: string }, type: EventType, payload: Record<string, unknown> = {}): Promise<void> {
    const [event] = await this.tx
      .insert(taskEvents)
      // clock_timestamp, not now(): several events of one transaction keep their order.
      .values({ taskId: task.id, actorId: this.actor.id, type, payload, at: sql`clock_timestamp()` })
      .returning({ id: taskEvents.id })

    const mode = isTaskEvent(type) ? ownerNotice(type, this.actor) : null
    if (!mode) return
    this.owner ??= ownerId(this.tx)
    const userId = await this.owner
    if (!userId || userId === this.actor.id) return
    // Delivery (in-app, push, digest) is a later stage; this is the outbox row.
    await this.tx.insert(notifications).values({
      userId,
      event: type,
      taskId: task.id,
      payload: { mode, taskTitle: task.title, actorId: this.actor.id, eventId: event!.id },
      dedupeKey: `${type}:${event!.id}`,
    })
  }
}
