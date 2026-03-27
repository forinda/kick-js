import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Delete, Inject } from '@forinda/kickjs-core'
import type { RequestContext, ParsedQuery } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  TASK_REPOSITORY,
  type ITaskRepository,
  type Task,
  type NewTask,
} from '../domain/repositories/task.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryTaskRepository implements ITaskRepository {
  private tasks: Task[] = [
    {
      id: 't1',
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'ALP-1',
      title: 'Setup CI',
      description: null,
      status: 'todo',
      priority: 'high',
      reporterId: 'u1',
      parentTaskId: null,
      dueDate: null,
      estimatePoints: null,
      orderIndex: 0,
      attachmentCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 't2',
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'ALP-2',
      title: 'Write tests',
      description: 'Add unit tests',
      status: 'in_progress',
      priority: 'medium',
      reporterId: 'u1',
      parentTaskId: null,
      dueDate: null,
      estimatePoints: 3,
      orderIndex: 1,
      attachmentCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]

  async findById(id: string) {
    return this.tasks.find((t) => t.id === id) ?? null
  }

  async findByProject(projectId: string) {
    return this.tasks.filter((t) => t.projectId === projectId)
  }

  async findPaginated(parsed: ParsedQuery) {
    const page = parsed.pagination?.page ?? 1
    const limit = parsed.pagination?.limit ?? 20
    const start = (page - 1) * limit
    return { data: this.tasks.slice(start, start + limit), total: this.tasks.length }
  }

  async findSubtasks(parentTaskId: string) {
    return this.tasks.filter((t) => t.parentTaskId === parentTaskId)
  }

  async create(dto: NewTask) {
    const task: Task = {
      id: `t${this.tasks.length + 1}`,
      projectId: dto.projectId,
      workspaceId: dto.workspaceId,
      key: dto.key,
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status ?? 'todo',
      priority: dto.priority ?? 'none',
      reporterId: dto.reporterId,
      parentTaskId: dto.parentTaskId ?? null,
      dueDate: dto.dueDate ?? null,
      estimatePoints: dto.estimatePoints ?? null,
      orderIndex: dto.orderIndex ?? 0,
      attachmentCount: dto.attachmentCount ?? 0,
      commentCount: dto.commentCount ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.tasks.push(task)
    return task
  }

  async update(id: string, dto: Partial<NewTask>) {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) throw new Error('Not found')
    Object.assign(task, dto, { updatedAt: new Date() })
    return task
  }

  async delete(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id)
  }
}

// ── Test controller (no auth middleware) ──────────────────────────────

@Controller()
class TestTaskController {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const tasks = await this.repo.findByProject('p1')
    ctx.json({ data: tasks, total: tasks.length })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const task = await this.repo.findById(ctx.params.id)
    if (!task) return ctx.notFound('Task not found')
    ctx.json({ data: task })
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.repo.delete(ctx.params.id)
    ctx.noContent()
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('TaskController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(TASK_REPOSITORY, () => new InMemoryTaskRepository())
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
    expect(res.body.total).toBe(2)
    expect(res.body.data[0]).toHaveProperty('title', 'Setup CI')
  })

  it('GET /api/v1/tasks/:id returns a single task', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/tasks/t1').expect(200)

    expect(res.body.data.title).toBe('Setup CI')
    expect(res.body.data.key).toBe('ALP-1')
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

  it('DELETE then list shows reduced count', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/tasks/t1').expect(204)

    const res = await request(expressApp).get('/api/v1/tasks').expect(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].title).toBe('Write tests')
  })
})
