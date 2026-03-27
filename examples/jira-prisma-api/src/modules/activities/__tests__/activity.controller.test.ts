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
      id: 'act1',
      workspaceId: 'ws1',
      actorId: 'u1',
      action: 'task.created',
      projectId: 'p1',
      taskId: 't1',
      changes: null,
      createdAt: new Date(),
    },
    {
      id: 'act2',
      workspaceId: 'ws1',
      actorId: 'u2',
      action: 'comment.created',
      projectId: 'p1',
      taskId: 't1',
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
  async create(data: any) {
    const activity = { id: `act${this.activities.length + 1}`, ...data, createdAt: new Date() }
    this.activities.push(activity)
    return activity
  }
}

// ── Test controller (no auth) ────────────────────────────────────────

@Controller()
class TestActivityController {
  constructor(
    @Inject(ACTIVITY_REPOSITORY) private readonly repo: IActivityRepository,
  ) {}

  @Get('/')
  async list(ctx: RequestContext) {
    const workspaceId = (ctx.query.workspaceId as string) || 'ws1'
    const result = await this.repo.findPaginated({} as any, { workspaceId })
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

  it('GET /api/v1/activities returns activity list', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .get('/api/v1/activities?workspaceId=ws1')
      .expect(200)

    expect(res.body.data).toHaveLength(2)
    expect(res.body.data[0].action).toBe('task.created')
  })

  it('GET /api/v1/activities returns empty for unknown workspace', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .get('/api/v1/activities?workspaceId=unknown')
      .expect(200)

    expect(res.body.data).toHaveLength(0)
    expect(res.body.total).toBe(0)
  })

  it('GET /api/v1/activities returns total count', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp)
      .get('/api/v1/activities?workspaceId=ws1')
      .expect(200)

    expect(res.body.total).toBe(2)
  })
})
