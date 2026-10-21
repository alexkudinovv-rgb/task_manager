import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'

// Conventions: snake_case columns, uuid PKs, timestamptz everywhere.
// Users and tasks are never hard-deleted (disabled_at / done+cancelled), so
// FKs to authorship columns are RESTRICT; owned child rows CASCADE.

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const tstz = (name: string) => timestamp(name, { withTimezone: true })

export const roleEnum = pgEnum('role', ['owner', 'director'])
export const taskStatusEnum = pgEnum('task_status', ['new', 'in_progress', 'done'])
export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high', 'hot'])
export const notificationModeEnum = pgEnum('notification_mode', ['instant', 'digest', 'off'])
export const notificationChannelEnum = pgEnum('notification_channel', ['in_app', 'push', 'telegram'])
export const dueRequestStateEnum = pgEnum('due_request_state', ['pending', 'approved', 'rejected'])

// ---------- directories ----------

export const positions = pgTable('positions', {
  id: id(),
  name: text('name').notNull().unique(),
  sort: integer('sort').notNull().default(0),
})

export const units = pgTable('units', {
  id: id(),
  name: text('name').notNull().unique(),
  sort: integer('sort').notNull().default(0),
})

// ---------- users & auth ----------

export const users = pgTable(
  'users',
  {
    id: id(),
    // Stored lowercased (enforced by CHECK) so the unique constraint is case-insensitive.
    login: text('login').notNull().unique(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    role: roleEnum('role').notNull().default('director'),
    positionId: uuid('position_id').references(() => positions.id, { onDelete: 'set null' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
    isAdmin: boolean('is_admin').notNull().default(false),
    // Null until the invite is accepted.
    passwordHash: text('password_hash'),
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    // Last accepted TOTP time step, to reject code replay.
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
    disabledAt: tstz('disabled_at'),
  },
  (t) => [
    uniqueIndex('users_single_owner').on(t.role).where(sql`role = 'owner'`),
    check('users_login_lowercase', sql`login = lower(login) AND length(login) > 0`),
    check('users_owner_is_admin', sql`role <> 'owner' OR is_admin`),
    check('users_totp_needs_secret', sql`NOT totp_enabled OR totp_secret_enc IS NOT NULL`),
  ],
)

export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    createdAt: createdAt(),
    usedAt: tstz('used_at'),
  },
  (t) => [index('recovery_codes_user_idx').on(t.userId)],
)

export const invites = pgTable(
  'invites',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('invites_user_idx').on(t.userId)],
)

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    // Absolute expiry (created_at + 30 days); not extended by activity.
    expiresAt: tstz('expires_at').notNull(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
)

export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: id(),
    login: text('login').notNull(),
    ip: inet('ip'),
    success: boolean('success').notNull(),
    at: tstz('at').notNull().defaultNow(),
  },
  (t) => [
    index('login_attempts_login_at_idx').on(t.login, t.at),
    index('login_attempts_ip_at_idx').on(t.ip, t.at),
  ],
)

// ---------- tasks ----------

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    // One level of nesting only; depth is enforced by the app.
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    responsibleId: uuid('responsible_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    status: taskStatusEnum('status').notNull().default('new'),
    priority: priorityEnum('priority').notNull().default('medium'),
    // Due date is required, time optional; both are Moscow local time.
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    dueTime: time('due_time'),
    startDate: date('start_date', { mode: 'string' }),
    requiresDocument: boolean('requires_document').notNull().default(false),
    cancelled: boolean('cancelled').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: tstz('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
    completedAt: tstz('completed_at'),
  },
  (t) => [
    // At most one not-done hot task per responsible.
    uniqueIndex('tasks_one_hot_per_responsible')
      .on(t.responsibleId)
      .where(sql`priority = 'hot' AND status <> 'done'`),
    index('tasks_responsible_idx').on(t.responsibleId),
    index('tasks_author_idx').on(t.authorId),
    index('tasks_parent_idx').on(t.parentId),
    index('tasks_status_idx').on(t.status),
    index('tasks_due_date_idx').on(t.dueDate),
    check('tasks_cancelled_only_done', sql`NOT cancelled OR status = 'done'`),
    check('tasks_completed_at_iff_done', sql`(status = 'done') = (completed_at IS NOT NULL)`),
    check('tasks_not_own_parent', sql`parent_id IS NULL OR parent_id <> id`),
    check('tasks_title_not_blank', sql`length(btrim(title)) > 0`),
  ],
)

export const taskCoexecutors = pgTable(
  'task_coexecutors',
  {
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    addedAt: tstz('added_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index('task_coexecutors_user_idx').on(t.userId),
  ],
)

export const checklistItems = pgTable(
  'checklist_items',
  {
    id: id(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('checklist_items_task_idx').on(t.taskId, t.sort)],
)

/** Task history; also the source for the "pulse" analytics (reopens, due changes, ...). */
export const taskEvents = pgTable(
  'task_events',
  {
    id: id(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    // Null for system events (e.g. overdue detection).
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    at: tstz('at').notNull().defaultNow(),
  },
  (t) => [
    index('task_events_task_at_idx').on(t.taskId, t.at),
    index('task_events_type_at_idx').on(t.type, t.at),
  ],
)

export const dueChangeRequests = pgTable(
  'due_change_requests',
  {
    id: id(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    newDueDate: date('new_due_date', { mode: 'string' }).notNull(),
    newDueTime: time('new_due_time'),
    reason: text('reason').notNull(),
    state: dueRequestStateEnum('state').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: tstz('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [
    // One open request per task at a time.
    uniqueIndex('due_change_requests_one_pending').on(t.taskId).where(sql`state = 'pending'`),
    index('due_change_requests_state_idx').on(t.state),
    check(
      'due_change_requests_decision_consistent',
      sql`(state = 'pending') = (decided_at IS NULL) AND (state = 'pending') = (decided_by IS NULL)`,
    ),
  ],
)

// ---------- chats & files ----------

export const messages = pgTable(
  'messages',
  {
    id: id(),
    // Null = the single general chat.
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    editedAt: tstz('edited_at'),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [index('messages_task_created_idx').on(t.taskId, t.createdAt)],
)

/** Per-user read marker; chat_key is a task id or 'general'. */
export const chatReads = pgTable(
  'chat_reads',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    chatKey: text('chat_key').notNull(),
    lastReadAt: tstz('last_read_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.chatKey] })],
)

/**
 * A file belongs to exactly one of: a task (e.g. the required document) or a
 * chat message (its task, if any, comes from the message). Exactly-one keeps
 * "does this task have a document" unambiguous and avoids orphans.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull().unique(),
    fileName: text('file_name').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    uploadedBy: uuid('uploaded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('attachments_task_idx').on(t.taskId),
    index('attachments_message_idx').on(t.messageId),
    check('attachments_exactly_one_owner', sql`num_nonnulls(task_id, message_id) = 1`),
    check('attachments_size_non_negative', sql`size_bytes >= 0`),
  ],
)

// ---------- notifications ----------

export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    mode: notificationModeEnum('mode').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.event, t.channel] })],
)

/** Admin-set defaults, used when a user has no row in notification_prefs. */
export const notificationDefaults = pgTable(
  'notification_defaults',
  {
    event: text('event').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    mode: notificationModeEnum('mode').notNull(),
  },
  (t) => [primaryKey({ columns: [t.event, t.channel] })],
)

/** In-app inbox and delivery outbox. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    // Optional idempotency key, e.g. 'due_reminder:<task>:1d', so schedulers can retry safely.
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    readAt: tstz('read_at'),
    deliveredAt: tstz('delivered_at'),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_unread_idx').on(t.userId).where(sql`read_at IS NULL`),
    index('notifications_undelivered_idx').on(t.createdAt).where(sql`delivered_at IS NULL`),
    uniqueIndex('notifications_user_dedupe').on(t.userId, t.dedupeKey),
  ],
)

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('push_subscriptions_user_idx').on(t.userId)],
)

export const telegramLinks = pgTable('telegram_links', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  chatId: bigint('chat_id', { mode: 'number' }).notNull().unique(),
  linkedAt: tstz('linked_at').notNull().defaultNow(),
})

export const telegramLinkCodes = pgTable(
  'telegram_link_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('telegram_link_codes_user_idx').on(t.userId)],
)

// ---------- MCP ----------

export const mcpKeys = pgTable(
  'mcp_keys',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    keyHash: text('key_hash').notNull().unique(),
    label: text('label').notNull(),
    createdAt: createdAt(),
    lastUsedAt: tstz('last_used_at'),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [index('mcp_keys_user_idx').on(t.userId)],
)

// ---------- row types ----------

export type Position = typeof positions.$inferSelect
export type NewPosition = typeof positions.$inferInsert
export type Unit = typeof units.$inferSelect
export type NewUnit = typeof units.$inferInsert
export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type RecoveryCode = typeof recoveryCodes.$inferSelect
export type Invite = typeof invites.$inferSelect
export type Session = typeof sessions.$inferSelect
export type LoginAttempt = typeof loginAttempts.$inferSelect
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type TaskCoexecutor = typeof taskCoexecutors.$inferSelect
export type ChecklistItem = typeof checklistItems.$inferSelect
export type TaskEvent = typeof taskEvents.$inferSelect
export type NewTaskEvent = typeof taskEvents.$inferInsert
export type DueChangeRequest = typeof dueChangeRequests.$inferSelect
export type Message = typeof messages.$inferSelect
export type ChatRead = typeof chatReads.$inferSelect
export type Attachment = typeof attachments.$inferSelect
export type NotificationPref = typeof notificationPrefs.$inferSelect
export type NotificationDefault = typeof notificationDefaults.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
export type PushSubscription = typeof pushSubscriptions.$inferSelect
export type TelegramLink = typeof telegramLinks.$inferSelect
export type TelegramLinkCode = typeof telegramLinkCodes.$inferSelect
export type McpKey = typeof mcpKeys.$inferSelect

export type Role = (typeof roleEnum.enumValues)[number]
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number]
export type Priority = (typeof priorityEnum.enumValues)[number]
export type NotificationMode = (typeof notificationModeEnum.enumValues)[number]
export type NotificationChannel = (typeof notificationChannelEnum.enumValues)[number]
export type DueRequestState = (typeof dueRequestStateEnum.enumValues)[number]
