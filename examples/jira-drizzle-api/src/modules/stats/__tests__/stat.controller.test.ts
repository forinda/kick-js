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
  type WorkspaceStats,
  type ProjectStats,
} from '../domain/repositories/stat.repository'

// ── In-memory repository ─────────────────────────────────────────────

class InMemoryStatsRepository implements IStatsRepository {
  private workspaceData: Record<string, WorkspaceStats> = {
    ws1: {
      memberCount: 5,
      projectCount: 3,
      taskCount: 20,
      openTasks: 12,
      completedTasks: 8,
      channelCount: 2,
    },
  }

  private projectData: Record<string, ProjectStats> = {
    p1: {
      taskCount: 10,
      tasksByStatus: { todo: 3, 'in-progress': 4, done: 3 },
      completionPercent: 30,
      commentCount: 15,
      attachmentCount: 5,
    },
  }

  async getWorkspaceStats(workspaceId: string): Promise<WorkspaceStats> {
    return (
      this.workspaceData[workspaceId] ?? {
        memberCount: 0,
        projectCount: 0,
        taskCount: 0,
        openTasks: 0,
        completedTasks: 0,
        channelCount: 0,
      }
    )
  }

  async getProjectStats(projectId: string): Promise<ProjectStats> {
    return (
      this.projectData[projectId] ?? {
        taskCount: 0,
        tasksByStatus: {},
        completionPercent: 0,
        commentCount: 0,
        attachmentCount: 0,
      }
    )
  }
}

// ── Test controller (no auth middleware) ──────────────────────────────

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

  it('GET /api/v1/stats/workspace/:workspaceId returns workspace stats', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/stats/workspace/ws1').expect(200)

    expect(res.body.data.memberCount).toBe(5)
    expect(res.body.data.projectCount).toBe(3)
    expect(res.body.data.taskCount).toBe(20)
    expect(res.body.data.openTasks).toBe(12)
    expect(res.body.data.completedTasks).toBe(8)
    expect(res.body.data.channelCount).toBe(2)
  })

  it('GET /api/v1/stats/workspace/:workspaceId returns defaults for unknown workspace', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/stats/workspace/unknown').expect(200)

    expect(res.body.data.memberCount).toBe(0)
    expect(res.body.data.taskCount).toBe(0)
  })

  it('GET /api/v1/stats/project/:projectId returns project stats', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/stats/project/p1').expect(200)

    expect(res.body.data.taskCount).toBe(10)
    expect(res.body.data.completionPercent).toBe(30)
    expect(res.body.data.commentCount).toBe(15)
    expect(res.body.data.tasksByStatus).toEqual({ todo: 3, 'in-progress': 4, done: 3 })
  })

  it('GET /api/v1/stats/project/:projectId returns defaults for unknown project', async () => {
    const { expressApp } = await createTestApp({ modules: [buildTestModule()] })

    const res = await request(expressApp).get('/api/v1/stats/project/unknown').expect(200)

    expect(res.body.data.taskCount).toBe(0)
    expect(res.body.data.completionPercent).toBe(0)
  })
})
