import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Delete, Inject, HttpException } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import type { ITaskRepository } from '../domain/repositories/task.repository'
import type { TaskEntity } from '../domain/entities/task.entity'
import type { Types } from 'mongoose'
import { TOKENS } from '@/shared/constants/tokens'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryTaskRepository implements ITaskRepository {
  private tasks: TaskEntity[] = [
    {
      _id: 't1' as unknown as Types.ObjectId,
      projectId: 'p1' as unknown as Types.ObjectId,
      workspaceId: 'ws1' as unknown as Types.ObjectId,
      key: 'PA-1',
      title: 'Fix login bug',
      status: 'To Do',
      priority: 'high',
      assigneeIds: [],
      reporterId: 'u1' as unknown as Types.ObjectId,
      labelIds: [],
      orderIndex: 0,
      attachmentCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      _id: 't2' as unknown as Types.ObjectId,
      projectId: 'p1' as unknown as Types.ObjectId,
      workspaceId: 'ws1' as unknown as Types.ObjectId,
      key: 'PA-2',
      title: 'Add dark mode',
      status: 'In Progress',
      priority: 'medium',
      assigneeIds: [],
      reporterId: 'u1' as unknown as Types.ObjectId,
      labelIds: [],
      orderIndex: 1,
      attachmentCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.tasks.find((t) => String(t._id) === id) ?? null
  }

  async findByProject(projectId: string) {
    return this.tasks.filter((t) => String(t.projectId) === projectId)
  }

  async findByKey(key: string) {
    return this.tasks.find((t) => t.key === key) ?? null
  }

  async create(data: Partial<TaskEntity>) {
    const task: TaskEntity = {
      _id: `t${this.tasks.length + 1}` as unknown as Types.ObjectId,
      projectId: data.projectId!,
      workspaceId: data.workspaceId!,
      key: data.key ?? `TASK-${this.tasks.length + 1}`,
      title: data.title!,
      status: data.status ?? 'To Do',
      priority: data.priority ?? 'medium',
      assigneeIds: data.assigneeIds ?? [],
      reporterId: data.reporterId!,
      labelIds: data.labelIds ?? [],
      orderIndex: data.orderIndex ?? 0,
      attachmentCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.tasks.push(task)
    return task
  }

  async update(id: string, data: Partial<TaskEntity>) {
    const task = this.tasks.find((t) => String(t._id) === id)
    if (!task) return null
    Object.assign(task, data, { updatedAt: new Date() })
    return task
  }

  async delete(id: string) {
    const len = this.tasks.length
    this.tasks = this.tasks.filter((t) => String(t._id) !== id)
    return this.tasks.length < len
  }

  async findPaginated() {
    return { data: this.tasks, total: this.tasks.length }
  }

  async findOverdue() {
    return []
  }

  async countByStatus() {
    return {}
  }

  async findSubtasks(parentTaskId: string) {
    return this.tasks.filter((t) => String(t.parentTaskId) === parentTaskId)
  }

  async incrementCommentCount() {}
  async incrementAttachmentCount() {}
}

// ── Test controller (no auth/guard middleware) ────────────────────────

@Controller()
class TestTaskController {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY) private readonly repo: ITaskRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const tasks = await this.repo.findByProject('p1')
    ctx.json({ data: tasks, total: tasks.length })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const task = await this.repo.findById(ctx.params.id)
    if (!task) throw HttpException.notFound('Task not found')
    ctx.json({ data: task })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    const deleted = await this.repo.delete(ctx.params.id)
    if (!deleted) throw HttpException.notFound('Task not found')
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TaskController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(TOKENS.TASK_REPOSITORY, () => new InMemoryTaskRepository())
        c.register(TestTaskController, TestTaskController)
      },
      routes: () => ({
        path: '/tasks',
        router: buildRoutes(TestTaskController),
        controller: TestTaskController,
      }),
    })
  }

  it('GET /api/v1/tasks returns task list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/tasks').expect(200)

    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0]).toHaveProperty('title', 'Fix login bug')
  })

  it('GET /api/v1/tasks/:id returns a single task', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/tasks/t1').expect(200)

    expect(res.body.data.title).toBe('Fix login bug')
    expect(res.body.data.key).toBe('PA-1')
  })

  it('GET /api/v1/tasks/:id returns 404 for unknown task', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/tasks/unknown').expect(404)
  })

  it('DELETE /api/v1/tasks/:id removes the task', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/tasks/t1').expect(204)

    await request(expressApp).get('/api/v1/tasks/t1').expect(404)
  })

  it('DELETE /api/v1/tasks/:id returns 404 for unknown task', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/tasks/unknown').expect(404)
  })
})
