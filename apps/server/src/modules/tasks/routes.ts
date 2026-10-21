import {
  ChecklistItemInput,
  ChecklistItemPatch,
  CoexecutorsInput,
  CreateTaskInput,
  DecideDueRequestInput,
  DueChangeRequestInput,
  TransitionInput,
  UpdateTaskInput,
} from '@car-city/shared/model'
import type { FastifyPluginAsync } from 'fastify'
import { requireActor } from '../../http/session'
import type { ModuleOptions } from '../types'
import { TaskService } from './service'

type WithId = { Params: { id: string } }

/** Workspace, tasks, subtasks, checklist, coexecutors, due requests. Routes: packages/shared/src/model/api.ts. */
export const taskRoutes: FastifyPluginAsync<ModuleOptions> = async (app, { db }) => {
  const service = new TaskService(db)

  app.get('/workspace', async (request) => service.workspace(requireActor(request)))

  app.get<WithId>('/tasks/:id', async (request) => service.details(requireActor(request), request.params.id))

  app.post('/tasks', async (request, reply) => {
    const actor = requireActor(request)
    reply.code(201)
    return service.create(actor, CreateTaskInput.parse(request.body))
  })

  app.patch<WithId>('/tasks/:id', async (request) => {
    const actor = requireActor(request)
    return service.update(actor, request.params.id, UpdateTaskInput.parse(request.body))
  })

  app.post<WithId>('/tasks/:id/transition', async (request) => {
    const actor = requireActor(request)
    return service.transition(actor, request.params.id, TransitionInput.parse(request.body))
  })

  app.put<WithId>('/tasks/:id/coexecutors', async (request) => {
    const actor = requireActor(request)
    return service.setCoexecutors(actor, request.params.id, CoexecutorsInput.parse(request.body))
  })

  app.post<WithId>('/tasks/:id/checklist', async (request, reply) => {
    const actor = requireActor(request)
    reply.code(201)
    return service.addChecklistItem(actor, request.params.id, ChecklistItemInput.parse(request.body))
  })

  app.patch<WithId>('/checklist/:id', async (request) => {
    const actor = requireActor(request)
    return service.updateChecklistItem(actor, request.params.id, ChecklistItemPatch.parse(request.body))
  })

  app.delete<WithId>('/checklist/:id', async (request, reply) => {
    await service.deleteChecklistItem(requireActor(request), request.params.id)
    return reply.code(204).send()
  })

  app.post<WithId>('/tasks/:id/due-requests', async (request, reply) => {
    const actor = requireActor(request)
    reply.code(201)
    return service.requestDueChange(actor, request.params.id, DueChangeRequestInput.parse(request.body))
  })

  app.post<WithId>('/due-requests/:id/decide', async (request) => {
    const actor = requireActor(request)
    return service.decideDueRequest(actor, request.params.id, DecideDueRequestInput.parse(request.body))
  })
}
