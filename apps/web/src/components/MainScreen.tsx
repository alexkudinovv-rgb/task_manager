import { useCallback, useEffect, useMemo, useState } from 'react'
import { canCreateTask, type Task, type WorkspaceDto } from '@car-city/shared/model'
import { DEMO, api, serverApi } from '../api'
import { errorMessage, isUnauthorized } from '../api/errors'
import { buildLookup, canViewerSee, resolveTask, type Lookup } from '../workspace'
import { Sidebar, type Section } from './Sidebar'
import { TaskForm, newTaskValues, toCreateInput } from './TaskForm'
import { TaskPanel } from './TaskPanel'
import { TasksPage } from './TasksPage'
import { Sheet } from './ui'
import { UsersPage } from './UsersPage'
import { OfflineBanner, PushSettings, UpdatePrompt } from '../pwa'
import { GeneralChatPage, useUnread } from '../chat'

/** Loads the workspace (mock in the demo, GET /api/workspace otherwise) and lays out the app. */
export function MainScreen({ onSignedOut }: { onSignedOut: () => void }) {
  const [workspace, setWorkspace] = useState<WorkspaceDto | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)

  const reload = useCallback(async () => {
    try {
      setWorkspace(await api.loadWorkspace())
      setLoadError(null)
    } catch (error) {
      setLoadError(error)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const lookup = useMemo(() => (workspace ? buildLookup(workspace, new Date()) : null), [workspace])

  if (!workspace || !lookup) {
    if (!loadError) return <p className="app-message">Загрузка…</p>
    return (
      <div className="app-message">
        <p>Не удалось загрузить задачи. {errorMessage(loadError)}</p>
        <button type="button" className="btn btn-secondary" onClick={() => void reload()}>
          Повторить
        </button>
      </div>
    )
  }
  return <Shell workspace={workspace} lookup={lookup} reload={reload} refreshError={loadError} onSignedOut={onSignedOut} />
}

interface ShellProps {
  workspace: WorkspaceDto
  lookup: Lookup
  reload: () => Promise<void>
  refreshError: unknown
  onSignedOut: () => void
}

function Shell({ workspace, lookup, reload, refreshError, onSignedOut }: ShellProps) {
  const [viewerId, setViewerId] = useState(workspace.me.id)
  const [section, setSection] = useState<Section>('tasks')
  const unread = useUnread()
  const [unitId, setUnitId] = useState<string | null>(null)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Real mode: the viewer is the signed-in user and the server already filtered the tasks.
  const viewer = DEMO ? (lookup.users.get(viewerId) ?? workspace.me) : workspace.me
  const sees = (task: Task) => !DEMO || canViewerSee(viewer, task, lookup)
  // Subtasks live inside their parent's panel, not on the board.
  const visible = workspace.tasks.filter((task) => task.parentId === null && sees(task)).map((task) => resolveTask(task, lookup))
  const unitCounts = workspace.units.map((unit) => ({ unit, count: visible.filter((v) => v.unit?.id === unit.id).length }))
  const openTask = openTaskId ? lookup.tasks.get(openTaskId) : undefined
  const openView = openTask && sees(openTask) ? resolveTask(openTask, lookup) : undefined
  const canManageUsers = !DEMO && workspace.me.isAdmin

  async function logout(everywhere: boolean) {
    if (everywhere && !window.confirm('Завершить сеансы на всех устройствах, включая этот?')) return
    try {
      await (everywhere ? serverApi.logoutAll() : serverApi.logout())
    } catch (error) {
      // 401: the session is already gone, which is what we wanted.
      if (!isUnauthorized(error)) {
        window.alert(`Не получилось выйти. ${errorMessage(error)}`)
        return
      }
    }
    onSignedOut()
  }

  return (
    <div className="app">
      <Sidebar
        section={section}
        onSection={setSection}
        canManageUsers={canManageUsers}
        units={unitCounts}
        activeUnitId={unitId}
        onSelectUnit={setUnitId}
        taskCount={visible.length}
        chatUnread={unread.general}
        me={DEMO ? null : workspace.me}
        onLogout={() => void logout(false)}
        onLogoutAll={() => void logout(true)}
      />

      <main className="main">
        <OfflineBanner />
        {refreshError != null && (
          <div className="error-note" role="alert">
            <p>Не удалось обновить данные. {errorMessage(refreshError)}</p>
          </div>
        )}
        {section === 'users' && canManageUsers ? (
          <UsersPage workspace={workspace} lookup={lookup} onChanged={reload} />
        ) : section === 'chat' ? (
          <GeneralChatPage users={workspace.users} me={viewer} />
        ) : section === 'settings' ? (
          <>
            <header className="page-head">
              <div className="page-head-title">
                <h1>Уведомления</h1>
              </div>
            </header>
            <PushSettings />
          </>
        ) : (
          <TasksPage
            workspace={workspace}
            lookup={lookup}
            visible={visible}
            viewer={viewer}
            onViewerChange={setViewerId}
            unitId={unitId}
            onUnitChange={setUnitId}
            onOpen={setOpenTaskId}
            onCreate={() => setCreating(true)}
          />
        )}
      </main>

      {openView && (
        <TaskPanel
          key={openView.task.id}
          view={openView}
          viewer={viewer}
          lookup={lookup}
          onClose={() => setOpenTaskId(null)}
          onOpenTask={setOpenTaskId}
          onChanged={reload}
        />
      )}

      {creating && (
        <Sheet title="Новая задача" onClose={() => setCreating(false)}>
          <TaskForm
            initial={newTaskValues(viewer.id)}
            lookup={lookup}
            canAssign={(user) => canCreateTask(viewer, user.id, user.role)}
            allowHot={viewer.role === 'owner'}
            submitLabel="Создать задачу"
            onSubmit={async (values) => {
              const task = await serverApi.createTask(toCreateInput(values))
              await reload()
              setCreating(false)
              setOpenTaskId(task.id)
            }}
            onCancel={() => setCreating(false)}
            onOpenTask={(id) => {
              setCreating(false)
              setOpenTaskId(id)
            }}
          />
        </Sheet>
      )}

      <UpdatePrompt />
    </div>
  )
}
