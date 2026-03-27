import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  ACTIVITY_REPOSITORY,
  type IActivityRepository,
} from '../domain/repositories/activity.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryActivityRepository implements IActivityRepository {
  private activities: any[] = [
    {
      id: 'a1',
      workspaceId: 'w1',
      projectId: 'p1',
      taskId: null,
      actorId: 'u1',
      action: 'project_created',
      changes: null,
      createdAt: new Date(),
    },
    {
      id: 'a2',
      workspaceId: 'w1',
      projectId: null,
      taskId: null,
      actorId: 'u2',
      action: 'member_joined',
      changes: null,
      createdAt: new Date(),
    },
  ]

  async findPaginated(
    _parsed: any,
    scope: { workspaceId: string; projectId?: string; taskId?: string },
  ) {
    let filtered = this.activities.filter((a) => a.workspaceId === scope.workspaceId)
    if (scope.projectId) filtered = filtered.filter((a) => a.projectId === scope.projectId)
    if (scope.taskId) filtered = filtered.filter((a) => a.taskId === scope.taskId)
    return { data: filtered, total: filtered.length }
  }

  async create(dto: any) {
    const activity = {
      id: `a${this.activities.length + 1}`,
      ...dto,
      projectId: dto.projectId ?? null,
      taskId: dto.taskId ?? null,
      changes: dto.changes ?? null,
      createdAt: new Date(),
    }
    this.activities.push(activity)
    return activity
  }
}

// ── Test controller ──────────────────────────────────────────────────

@Controller()
class TestActivityController {
  constructor(
    @Inject(ACTIVITY_REPOSITORY) private readonly repo: IActivityRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const workspaceId = ctx.query.workspaceId as string
    if (!workspaceId) {
      ctx.res.status(400).json({ message: 'workspaceId query parameter is required' })
      return
    }
    const result = await this.repo.findPaginated({} as any, {
      workspaceId,
      projectId: ctx.query.projectId as string | undefined,
      taskId: ctx.query.taskId as string | undefined,
    })
    ctx.json(result)
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

  it('GET /api/v1/activities?workspaceId=w1 returns activities', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp)
      .get('/api/v1/activities?workspaceId=w1')
      .expect(200)

    expect(res.body.data).toHaveLength(2)
    expect(res.body.total).toBe(2)
  })

  it('GET /api/v1/activities without workspaceId returns 400', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    await request(expressApp).get('/api/v1/activities').expect(400)
  })

  it('GET /api/v1/activities?workspaceId=w1&projectId=p1 filters by project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp)
      .get('/api/v1/activities?workspaceId=w1&projectId=p1')
      .expect(200)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].action).toBe('project_created')
  })
})
