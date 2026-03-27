import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Post, Delete, Inject } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  TASK_REPOSITORY,
  type ITaskRepository,
} from '../domain/repositories/task.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryTaskRepository implements ITaskRepository {
  private tasks: any[] = [
    {
      id: 't1',
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'ALPHA-1',
      title: 'First task',
      description: null,
      status: 'todo',
      priority: 'medium',
      reporterId: 'u1',
      parentTaskId: null,
      dueDate: null,
      estimatePoints: null,
      orderIndex: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 't2',
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'ALPHA-2',
      title: 'Second task',
      description: null,
      status: 'in_progress',
      priority: 'high',
      reporterId: 'u1',
      parentTaskId: null,
      dueDate: null,
      estimatePoints: null,
      orderIndex: 1,
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
  async findPaginated() {
    return { data: this.tasks, total: this.tasks.length }
  }
  async findSubtasks(parentTaskId: string) {
    return this.tasks.filter((t) => t.parentTaskId === parentTaskId)
  }
  async create(dto: any) {
    const task = {
      id: `t${this.tasks.length + 1}`,
      ...dto,
      status: dto.status ?? 'todo',
      priority: dto.priority ?? 'medium',
      parentTaskId: dto.parentTaskId ?? null,
      dueDate: dto.dueDate ?? null,
      estimatePoints: dto.estimatePoints ?? null,
      orderIndex: dto.orderIndex ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.tasks.push(task)
    return task
  }
  async update(id: string, dto: any) {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) throw new Error('Not found')
    Object.assign(task, dto, { updatedAt: new Date() })
    return task
  }
  async delete(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id)
  }
}

// ── Test controller (no auth) ────────────────────────────────────────

@Controller()
class TestTaskController {
  constructor(
    @Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.repo.findPaginated({} as any)
    ctx.json({ data: result.data, total: result.total })
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const task = await this.repo.findById(ctx.params.id)
    if (!task) return ctx.notFound('Task not found')
    ctx.json({ data: task })
  }

  @Post('/')
  async create(ctx: RequestContext) {
    const task = await this.repo.create(ctx.body)
    ctx.created({ data: task })
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
  })

  it('GET /api/v1/tasks/:id returns a single task', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/tasks/t1').expect(200)

    expect(res.body.data.title).toBe('First task')
    expect(res.body.data.key).toBe('ALPHA-1')
  })

  it('GET /api/v1/tasks/:id returns 404 for unknown', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/tasks/unknown').expect(404)
  })

  it('POST /api/v1/tasks creates a new task', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .post('/api/v1/tasks')
      .send({
        projectId: 'p1',
        workspaceId: 'ws1',
        key: 'ALPHA-3',
        title: 'New task',
        reporterId: 'u1',
      })
      .expect(201)

    expect(res.body.data.title).toBe('New task')
  })

  it('DELETE /api/v1/tasks/:id removes the task', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).delete('/api/v1/tasks/t1').expect(204)
    await request(expressApp).get('/api/v1/tasks/t1').expect(404)
  })
})
