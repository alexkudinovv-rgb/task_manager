import { canSee, type Actor, type AttachmentDto, type Task } from '@car-city/shared/model'
import { desc, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { attachments, messages, type Attachment } from '../../db/schema'
import { apiError } from '../../http/errors'
import { publishTaskChanged } from '../chats/service'
import { contextFrom, isUuid, loadFamily, lockTask, type Conn } from '../tasks/repository'

const notFound = (message = 'Файл не найден') => apiError(404, 'not_found', { message })
const taskNotFound = () => apiError(404, 'not_found', { message: 'Задача не найдена' })
const DONE_MESSAGE = 'Задача завершена: сначала верните её в работу'

export interface NewFile {
  storageKey: string
  fileName: string
  sizeBytes: number
  mime: string
}

export function toAttachmentDto(row: Attachment): AttachmentDto {
  return {
    id: row.id,
    taskId: row.taskId,
    messageId: row.messageId,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    mime: row.mime,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    url: `/api/attachments/${row.id}`,
  }
}

/** The task when the actor can see it; 404 otherwise (missing and invisible look the same). */
async function visibleTask(conn: Conn, actor: Actor, taskId: string): Promise<Task> {
  if (!isUuid(taskId)) throw taskNotFound()
  const family = await loadFamily(conn, taskId)
  const task = family.find((t) => t.id === taskId)
  if (!task) throw taskNotFound()
  const ctx = contextFrom(task, new Map(family.map((t) => [t.id, t])), family.filter((t) => t.parentId === taskId))
  if (!canSee(actor, task, ctx)) throw taskNotFound()
  return task
}

export class AttachmentService {
  constructor(private readonly db: Db) {}

  async list(actor: Actor, taskId: string): Promise<AttachmentDto[]> {
    const task = await visibleTask(this.db, actor, taskId)
    const rows = await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.taskId, task.id))
      .orderBy(desc(attachments.createdAt), desc(attachments.id))
    return rows.map(toAttachmentDto)
  }

  /** Cheap check before the body is read: whoever sees the task may add files until it is done. */
  async assertCanUpload(actor: Actor, taskId: string): Promise<Task> {
    const task = await visibleTask(this.db, actor, taskId)
    if (task.status === 'done') throw apiError(403, 'forbidden', { message: DONE_MESSAGE })
    return task
  }

  /** Records a stored file; re-checks under the task lock since the upload took a while. */
  async create(actor: Actor, taskId: string, file: NewFile): Promise<AttachmentDto> {
    const dto = await this.db.transaction(async (tx) => {
      await lockTask(tx, taskId)
      const task = await visibleTask(tx, actor, taskId)
      if (task.status === 'done') throw apiError(403, 'forbidden', { message: DONE_MESSAGE })
      const [row] = await tx
        .insert(attachments)
        .values({ taskId: task.id, uploadedBy: actor.id, ...file })
        .returning()
      return toAttachmentDto(row!)
    })
    await this.announce(taskId)
    return dto
  }

  /**
   * The attachment if the actor may open it. Task files follow task visibility; chat files follow
   * their message: a task chat like its task, the general chat for everyone with a session.
   */
  async findVisible(actor: Actor, attachmentId: string): Promise<Attachment> {
    if (!isUuid(attachmentId)) throw notFound()
    const [row] = await this.db.select().from(attachments).where(eq(attachments.id, attachmentId))
    if (!row) throw notFound()
    const taskId = row.taskId ?? (await this.messageTaskId(row.messageId!))
    if (taskId !== null) await visibleTask(this.db, actor, taskId).catch(() => Promise.reject(notFound()))
    return row
  }

  /** Deletes the row and returns its storage key; the caller removes the object afterwards. */
  async remove(actor: Actor, attachmentId: string): Promise<string> {
    const found = await this.findVisible(actor, attachmentId)
    if (found.taskId === null) {
      throw apiError(403, 'forbidden', { message: 'Файл из чата удаляется вместе с сообщением' })
    }
    const taskId = found.taskId
    const storageKey = await this.db.transaction(async (tx) => {
      await lockTask(tx, taskId)
      const task = await visibleTask(tx, actor, taskId).catch(() => Promise.reject(notFound()))
      const [row] = await tx.select().from(attachments).where(eq(attachments.id, attachmentId))
      if (!row) throw notFound()
      const allowed = row.uploadedBy === actor.id || task.authorId === actor.id || actor.role === 'owner'
      if (!allowed) throw apiError(403, 'forbidden', { message: 'Удалить файл может загрузивший, постановщик или собственник' })
      if (task.status === 'done') throw apiError(403, 'forbidden', { message: DONE_MESSAGE })
      await tx.delete(attachments).where(eq(attachments.id, row.id))
      return row.storageKey
    })
    await this.announce(taskId)
    return storageKey
  }

  /** The file count is part of the task (a «нужен документ» task can be completed), so viewers refetch. */
  private async announce(taskId: string): Promise<void> {
    // The change is committed; clients catch up on their next reload or reconnect.
    await publishTaskChanged(this.db, taskId).catch(() => {})
  }

  /** The task of a message's chat, null for the general chat; 404 for deleted messages. */
  private async messageTaskId(messageId: string): Promise<string | null> {
    const [message] = await this.db
      .select({ taskId: messages.taskId, deletedAt: messages.deletedAt })
      .from(messages)
      .where(eq(messages.id, messageId))
    if (!message || message.deletedAt) throw notFound()
    return message.taskId
  }
}
