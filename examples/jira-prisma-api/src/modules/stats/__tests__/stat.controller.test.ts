import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Inject } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { buildRoutes } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  STATS_REPOSITORY,
  type IStatsRepository,
} from '../domain/repositories/stat.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryStatsRepository implements IStatsRepository {
  async getWorkspaceStats(_workspaceId: string) {
    return {
      memberCount: 5,
      projectCount: 3,
      taskCount: 42,
      openTasks: 20,
      completedTasks: 22,
      channelCount: 2,
    }
  }
  async getProjectStats(_projectId: string) {
    return {
      taskCount: 10,
      tasksByStatus: { todo: 3, in_progress: 4, done: 3 },
      completionPercent: 30,
      commentCount: 15,
      attachmentCount: 5,
    }
  }
}

// ── Test controller (no auth) ────────────────────────────────────────

@Controller()
class TestStatController {
  constructor(
    @Inject(STATS_REPOSITORY) private readonly repo: IStatsRepository,
  ) {}

  @Get('/workspace/:workspaceId')
  async workspaceStats(ctx: RequestContext) {
    const stats = await this.repo.getWorkspaceStats(ctx.params.workspaceId)
    ctx.json({ data: stats })
  }

  @Get('/project/:projectId')
  async projectStats(ctx: RequestContext) {
    const stats = await this.repo.getProjectStats(ctx.params.projectId)
    ctx.json({ data: stats })
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('StatController (integration)', () => {
  beforeEach(() => Container.reset())

  function buildTestModule() {
    return createTestModule({
      register: (c) => {
        c.registerFactory(STATS_REPOSITORY, () => new InMemoryStatsRepository())
        c.register(TestStatController, TestStatController)
      },
      routes: () => ({
        path: '/stats',
        router: buildRoutes(TestStatController),
        controller: TestStatController,
      }),
    })
  }

  it('GET /api/v1/stats/workspace/:id returns workspace stats', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/stats/workspace/ws1').expect(200)

    expect(res.body.data.memberCount).toBe(5)
    expect(res.body.data.projectCount).toBe(3)
    expect(res.body.data.taskCount).toBe(42)
  })

  it('GET /api/v1/stats/project/:id returns project stats', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/stats/project/p1').expect(200)

    expect(res.body.data.taskCount).toBe(10)
    expect(res.body.data.completionPercent).toBe(30)
    expect(res.body.data.tasksByStatus).toEqual({ todo: 3, in_progress: 4, done: 3 })
  })

  it('workspace stats includes channel count', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/stats/workspace/ws1').expect(200)

    expect(res.body.data.channelCount).toBe(2)
  })
})
