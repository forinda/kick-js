import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Container, Controller, Get, Inject } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  STATS_REPOSITORY,
  type IStatsRepository,
} from '../domain/repositories/stat.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryStatsRepository implements IStatsRepository {
  async getWorkspaceStats(workspaceId: string) {
    if (workspaceId === 'w1') {
      return {
        memberCount: 5,
        projectCount: 3,
        taskCount: 42,
        openTasks: 15,
        completedTasks: 27,
        channelCount: 4,
      }
    }
    return {
      memberCount: 0,
      projectCount: 0,
      taskCount: 0,
      openTasks: 0,
      completedTasks: 0,
      channelCount: 0,
    }
  }

  async getProjectStats(projectId: string) {
    if (projectId === 'p1') {
      return {
        taskCount: 20,
        tasksByStatus: { todo: 5, in_progress: 8, done: 7 },
        completionPercent: 35,
        commentCount: 45,
        attachmentCount: 12,
      }
    }
    return {
      taskCount: 0,
      tasksByStatus: {},
      completionPercent: 0,
      commentCount: 0,
      attachmentCount: 0,
    }
  }
}

// ── Test controller ──────────────────────────────────────────────────

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
    const res = await request(expressApp).get('/api/v1/stats/workspace/w1').expect(200)

    expect(res.body.data.memberCount).toBe(5)
    expect(res.body.data.taskCount).toBe(42)
    expect(res.body.data.channelCount).toBe(4)
  })

  it('GET /api/v1/stats/workspace/:id returns zeros for unknown workspace', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/stats/workspace/unknown').expect(200)

    expect(res.body.data.memberCount).toBe(0)
    expect(res.body.data.taskCount).toBe(0)
  })

  it('GET /api/v1/stats/project/:id returns project stats', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })
    const res = await request(expressApp).get('/api/v1/stats/project/p1').expect(200)

    expect(res.body.data.taskCount).toBe(20)
    expect(res.body.data.completionPercent).toBe(35)
    expect(res.body.data.tasksByStatus).toHaveProperty('todo', 5)
  })
})
