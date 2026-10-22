import {
  allowedActions,
  canSee,
  MESSAGE_EDIT_WINDOW_MS,
  type Actor,
  type ChatKey,
  type MessageDto,
  type MessageInput,
  type MessagesPage,
  type Task,
  type UnreadDto,
  type VisibilityContext,
  type WsEvent,
} from '@car-city/shared/model'
import { and, count, desc, eq, getTableColumns, gt, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db } from '../../db/client'
import { chatReads, messages, sessions, tasks, users, type Message } from '../../db/schema'
import { apiError } from '../../http/errors'
import { contextFrom, isUuid, loadFamily, loadTasks, type Conn } from '../tasks/repository'
import { liveHub } from './hub'
import { mentionTokens, resolveMentions } from './mentions'

export const PAGE_DEFAULT = 50
export const PAGE_MAX = 100

const notFound = () => apiError(404, 'not_found', { message: 'Чат не найден' })
const forbidden = (message: string) => apiError(403, 'forbidden', { message })
const READ_ONLY = 'Задача завершена — чат только для чтения'

/** Who reads and who writes one chat. */
interface Audience {
  key: ChatKey
  taskId: string | null
  sees: (actor: Actor) => boolean
  /** False for everyone in a done task's chat. */
  writes: (actor: Actor) => boolean
}

const GENERAL: Audience = { key: 'general', taskId: null, sees: () => true, writes: () => true }

/** The chat behind `chatKey`, or null when there is no such chat. Task chats follow task visibility. */
async function audienceOf(conn: Conn, chatKey: string): Promise<Audience | null> {
  if (chatKey === 'general') return GENERAL
  if (!isUuid(chatKey)) return null
  const family = await loadFamily(conn, chatKey)
  const task = family.find((t) => t.id === chatKey)
  if (!task) return null
  const byId = new Map(family.map((t) => [t.id, t]))
  const ctx = contextFrom(task, byId, family.filter((t) => t.parentId === task.id))
  return {
    key: task.id,
    taskId: task.id,
    sees: (actor) => canSee(actor, task, ctx),
    writes: (actor) => allowedActions(actor, task, ctx).comment,
  }
}

function publishTo(audience: Audience, event: WsEvent): void {
  if (audience.taskId === null) return liveHub.broadcast(event)
  liveHub.publish(
    liveHub
      .connected()
      .filter(audience.sees)
      .map((actor) => actor.id),
    event,
  )
}

/** Sends `event` to every connected user who can see the chat (general: everyone connected). */
export async function publishToChat(conn: Conn, chatKey: string, event: WsEvent): Promise<void> {
  const audience = await audienceOf(conn, chatKey)
  if (audience) publishTo(audience, event)
}

/** Connected users who can see the task, taken before a change that may hide it from some of them. */
export function connectedViewers(task: Task, ctx: VisibilityContext): string[] {
  return liveHub
    .connected()
    .filter((actor) => canSee(actor, task, ctx))
    .map((actor) => actor.id)
}

/** { type: 'task.changed' } to every connected user who sees the task now, plus `alsoTo` (who saw it before). */
export async function publishTaskChanged(conn: Conn, taskId: string, alsoTo: string[] = []): Promise<void> {
  const audience = await audienceOf(conn, taskId)
  const viewers = audience
    ? liveHub
        .connected()
        .filter(audience.sees)
        .map((actor) => actor.id)
    : []
  liveHub.publish([...alsoTo, ...viewers], { type: 'task.changed', taskId })
}

/** For the heartbeat: the session behind a socket still exists and its user is active. */
export async function sessionAlive(conn: Conn, sessionId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt)))
    .limit(1)
  return row !== undefined
}

// Paging cursor with Postgres' microseconds, so `before` never cuts between two rows a JS Date can't tell apart.
const CURSOR = sql<string>`to_char(${messages.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

const chatFilter = (taskId: string | null): SQL => (taskId === null ? isNull(messages.taskId) : eq(messages.taskId, taskId))

function toMessageDto(row: Message, mentions: string[]): MessageDto {
  const deleted = row.deletedAt !== null
  return {
    id: row.id,
    chatKey: row.taskId ?? 'general',
    taskId: row.taskId,
    authorId: row.authorId,
    body: deleted ? '' : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deleted,
    mentions: deleted ? [] : mentions,
    // Files in chat messages come with a later stage.
    attachments: [],
  }
}

export class ChatService {
  constructor(private readonly db: Db) {}

  async page(actor: Actor, chatKey: string, query: { before?: string; limit: number }): Promise<MessagesPage> {
    const audience = await this.visible(actor, chatKey)
    const conditions = [chatFilter(audience.taskId)]
    if (query.before) conditions.push(lt(messages.createdAt, sql`${query.before}::timestamptz`))
    const select = (where: SQL | undefined) =>
      this.db
        .select({ ...getTableColumns(messages), cursor: CURSOR })
        .from(messages)
        .where(where)
        .orderBy(desc(messages.createdAt), desc(messages.id))

    const rows = await select(and(...conditions)).limit(query.limit + 1)
    let page = rows
    let nextBefore: string | null = null
    if (rows.length > query.limit) {
      page = rows.slice(0, query.limit)
      const edge = page[page.length - 1]!.cursor
      if (rows[query.limit]!.cursor === edge) {
        // `before` is exclusive: messages sharing the edge timestamp go to one page together.
        page = page.filter((row) => row.cursor !== edge)
        if (page.length === 0) page = await select(and(...conditions, eq(messages.createdAt, sql`${edge}::timestamptz`)))
      }
      nextBefore = page[page.length - 1]!.cursor
    }
    return { messages: await this.toDtos(page, audience), nextBefore }
  }

  async post(actor: Actor, chatKey: string, input: MessageInput): Promise<MessageDto> {
    const audience = await this.visible(actor, chatKey)
    if (!audience.writes(actor)) throw forbidden(READ_ONLY)
    const [row] = await this.db
      .insert(messages)
      .values({ taskId: audience.taskId, authorId: actor.id, body: input.body })
      .returning()
    const [message] = await this.toDtos([row!], audience)
    publishTo(audience, { type: 'message.created', message: message! })
    return message!
  }

  async edit(actor: Actor, messageId: string, input: MessageInput): Promise<MessageDto> {
    const { row, audience } = await this.ownMessage(actor, messageId)
    let updated = row
    if (input.body !== row.body) {
      const [next] = await this.db
        .update(messages)
        .set({ body: input.body, editedAt: new Date() })
        .where(and(eq(messages.id, row.id), isNull(messages.deletedAt)))
        .returning()
      if (!next) throw forbidden('Сообщение уже удалено')
      updated = next
    }
    const [message] = await this.toDtos([updated], audience)
    if (updated !== row) publishTo(audience, { type: 'message.updated', message: message! })
    return message!
  }

  /** Soft delete: the row stays in history with an empty body. */
  async remove(actor: Actor, messageId: string): Promise<void> {
    const { row, audience } = await this.ownMessage(actor, messageId)
    const [deleted] = await this.db
      .update(messages)
      .set({ body: '', deletedAt: new Date() })
      .where(and(eq(messages.id, row.id), isNull(messages.deletedAt)))
      .returning()
    if (!deleted) return
    publishTo(audience, { type: 'message.deleted', message: toMessageDto(deleted, []) })
  }

  async markRead(actor: Actor, chatKey: string): Promise<void> {
    const audience = await this.visible(actor, chatKey)
    // Database time, the same clock that stamps messages.created_at.
    await this.db
      .insert(chatReads)
      .values({ userId: actor.id, chatKey: audience.key, lastReadAt: sql`now()` })
      .onConflictDoUpdate({ target: [chatReads.userId, chatReads.chatKey], set: { lastReadAt: sql`now()` } })
    liveHub.publish([actor.id], { type: 'chat.read', chatKey: audience.key, userId: actor.id })
  }

  /** Messages from others after the viewer's read marker (never read = all), per visible chat. */
  async unread(actor: Actor): Promise<UnreadDto> {
    const rows = await this.db
      .select({ taskId: messages.taskId, total: count() })
      .from(messages)
      .leftJoin(
        chatReads,
        and(eq(chatReads.userId, actor.id), eq(chatReads.chatKey, sql`coalesce(${messages.taskId}::text, 'general')`)),
      )
      .where(
        and(
          ne(messages.authorId, actor.id),
          isNull(messages.deletedAt),
          or(isNull(chatReads.lastReadAt), gt(messages.createdAt, chatReads.lastReadAt)),
        ),
      )
      .groupBy(messages.taskId)

    const result: UnreadDto = { general: 0, tasks: {} }
    const perTask = new Map<string, number>()
    for (const row of rows) {
      if (row.taskId === null) result.general = row.total
      else if (row.total > 0) perTask.set(row.taskId, row.total)
    }
    for (const taskId of await this.visibleTaskIds(actor, [...perTask.keys()])) {
      result.tasks[taskId] = perTask.get(taskId)!
    }
    return result
  }

  // ---------- helpers ----------

  /** The chat if the actor can see it; 404 otherwise (also for chats that don't exist). */
  private async visible(actor: Actor, chatKey: string): Promise<Audience> {
    const audience = await audienceOf(this.db, chatKey)
    if (!audience || !audience.sees(actor)) throw notFound()
    return audience
  }

  /** A message the actor may still change: own, not deleted, within the edit window, chat not read-only. */
  private async ownMessage(actor: Actor, messageId: string): Promise<{ row: Message; audience: Audience }> {
    if (!isUuid(messageId)) throw notFound()
    const [row] = await this.db.select().from(messages).where(eq(messages.id, messageId))
    if (!row) throw notFound()
    const audience = await audienceOf(this.db, row.taskId ?? 'general')
    if (!audience || !audience.sees(actor)) throw notFound()
    if (row.authorId !== actor.id) throw forbidden('Менять можно только свои сообщения')
    if (row.deletedAt) throw forbidden('Сообщение уже удалено')
    if (Date.now() - row.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MS) {
      throw forbidden('Прошло больше 15 минут — сообщение уже не изменить')
    }
    if (!audience.writes(actor)) throw forbidden(READ_ONLY)
    return { row, audience }
  }

  /** Mentions are kept only for active users who can see the chat. */
  private async toDtos(rows: Message[], audience: Audience): Promise<MessageDto[]> {
    const tokens = [...new Set(rows.filter((row) => row.deletedAt === null).flatMap((row) => mentionTokens(row.body)))]
    const idsByLogin = new Map<string, string>()
    if (tokens.length > 0) {
      const found = await this.db
        .select({ id: users.id, login: users.login, role: users.role })
        .from(users)
        .where(and(inArray(users.login, tokens), isNull(users.disabledAt)))
      for (const user of found) if (audience.sees(user)) idsByLogin.set(user.login, user.id)
    }
    return rows.map((row) => toMessageDto(row, resolveMentions(row.body, idsByLogin)))
  }

  /** Which of `taskIds` the actor can see, judged with each task's parent and subtasks. */
  private async visibleTaskIds(actor: Actor, taskIds: string[]): Promise<string[]> {
    if (taskIds.length === 0) return []
    const p = alias(tasks, 'p')
    const parents = this.db.select({ id: p.parentId }).from(p).where(inArray(p.id, taskIds))
    const family = await loadTasks(
      this.db,
      or(inArray(tasks.id, taskIds), inArray(tasks.parentId, taskIds), inArray(tasks.id, parents)),
    )
    const byId = new Map(family.map((t) => [t.id, t]))
    return taskIds.filter((id) => {
      const task = byId.get(id)
      return task !== undefined && canSee(actor, task, contextFrom(task, byId, family.filter((t) => t.parentId === id)))
    })
  }
}
