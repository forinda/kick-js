import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Inject } from '@forinda/kickjs-core'
import type { RequestContext, ParsedQuery } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  ACTIVITY_REPOSITORY,
  type IActivityRepository,
  type Activity,
  type NewActivity,
} from '../domain/repositories/activity.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryActivityRepository implements IActivityRepository {
  private activities: Activity[] = [
    {
      id: 'a1',
      workspaceId: 'ws1',
      projectId: 'p1',
      taskId: null,
      actorId: 'u1',
      action: 'task.created',
      changes: null,
      createdAt: new Date(),
    },
    {
      id: 'a2',
      workspaceId: 'ws1',
      projectId: null,
      taskId: null,
      actorId: 'u2',
      action: 'comment.added',
      changes: { body: { from: '', to: 'Hello' } },
      createdAt: new Date(),
    },
    {
      id: 'a3',
      workspaceId: 'ws2',
      projectId: null,
      taskId: null,
      actorId: 'u1',
      action: 'project.deleted',
      changes: null,
      createdAt: new Date(),
    },
  ]

  async findPaginated(
    parsed: ParsedQuery,
    scope: { workspaceId: string; projectId?: string; taskId?: string },
  ) {
    let filtered = this.activities.filter((a) => a.workspaceId === scope.workspaceId)
    if (scope.projectId) filtered = filtered.filter((a) => a.projectId === scope.projectId)
    if (scope.taskId) filtered = filtered.filter((a) => a.taskId === scope.taskId)
    const page = parsed.pagination?.page ?? 1
    const limit = parsed.pagination?.limit ?? 20
    const start = (page - 1) * limit
    return { data: filtered.slice(start, start + limit), total: filtered.length }
  }

  async create(dto: NewActivity) {
    const activity: Activity = {
      id: `a${this.activities.length + 1}`,
      workspaceId: dto.workspaceId,
      projectId: dto.projectId ?? null,
      taskId: dto.taskId ?? null,
      actorId: dto.actorId,
      action: dto.action,
      changes: dto.changes ?? null,
      createdAt: new Date(),
    }
    this.activities.push(activity)
    return activity
  }
}

// ── Test controller (no auth middleware) ──────────────────────────────

@Controller()
class TestActivityController {
  constructor(
    @Inject(ACTIVITY_REPOSITORY) private readonly repo: IActivityRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const workspaceId = ctx.query.workspaceId as string
    if (!workspaceId) {
      return ctx.badRequest('workspaceId query parameter is required')
    }
    const result = await this.repo.findPaginated(
      {},
      {
        workspaceId,
        projectId: ctx.query.projectId as string | undefined,
        taskId: ctx.query.taskId as string | undefined,
      },
    )
    ctx.json({ data: result.data, total: result.total })
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ActivityController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(ACTIVITY_REPOSITORY, () => new InMemoryActivityRepository())
        c.register(TestActivityController, TestActivityController)
      },
      routes: () => ({
        path: '/activities',
        router: buildRoutes(TestActivityController),
        controller: TestActivityController,
      }),
    })
  }

  it('GET /api/v1/activities?workspaceId=ws1 returns filtered activities', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/activities?workspaceId=ws1').expect(200)

    expect(res.body.data).toHaveLength(2)
    expect(res.body.total).toBe(2)
    expect(res.body.data[0]).toHaveProperty('action', 'task.created')
  })

  it('GET /api/v1/activities without workspaceId returns 400', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    await request(expressApp).get('/api/v1/activities').expect(400)
  })

  it('GET /api/v1/activities filters by projectId', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .get('/api/v1/activities?workspaceId=ws1&projectId=p1')
      .expect(200)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].action).toBe('task.created')
  })

  it('GET /api/v1/activities for unknown workspace returns empty list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .get('/api/v1/activities?workspaceId=unknown')
      .expect(200)

    expect(res.body.data).toHaveLength(0)
    expect(res.body.total).toBe(0)
  })
})
