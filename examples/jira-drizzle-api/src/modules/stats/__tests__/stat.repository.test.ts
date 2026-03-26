import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IStatsRepository,
  WorkspaceStats,
  ProjectStats,
} from '../domain/repositories/stat.repository'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryStatsRepository implements IStatsRepository {
  private workspaceData: Record<string, WorkspaceStats> = {}
  private projectData: Record<string, ProjectStats> = {}

  setWorkspaceStats(workspaceId: string, stats: WorkspaceStats) {
    this.workspaceData[workspaceId] = stats
  }

  setProjectStats(projectId: string, stats: ProjectStats) {
    this.projectData[projectId] = stats
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

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryStatsRepository', () => {
  let repo: InMemoryStatsRepository

  beforeEach(() => {
    repo = new InMemoryStatsRepository()
  })

  it('getWorkspaceStats returns defaults for unknown workspace', async () => {
    const stats = await repo.getWorkspaceStats('unknown')

    expect(stats.memberCount).toBe(0)
    expect(stats.projectCount).toBe(0)
    expect(stats.taskCount).toBe(0)
    expect(stats.openTasks).toBe(0)
    expect(stats.completedTasks).toBe(0)
    expect(stats.channelCount).toBe(0)
  })

  it('getWorkspaceStats returns stored stats', async () => {
    repo.setWorkspaceStats('ws1', {
      memberCount: 5,
      projectCount: 3,
      taskCount: 20,
      openTasks: 12,
      completedTasks: 8,
      channelCount: 2,
    })

    const stats = await repo.getWorkspaceStats('ws1')
    expect(stats.memberCount).toBe(5)
    expect(stats.projectCount).toBe(3)
    expect(stats.taskCount).toBe(20)
    expect(stats.openTasks).toBe(12)
    expect(stats.completedTasks).toBe(8)
    expect(stats.channelCount).toBe(2)
  })

  it('getProjectStats returns defaults for unknown project', async () => {
    const stats = await repo.getProjectStats('unknown')

    expect(stats.taskCount).toBe(0)
    expect(stats.tasksByStatus).toEqual({})
    expect(stats.completionPercent).toBe(0)
    expect(stats.commentCount).toBe(0)
    expect(stats.attachmentCount).toBe(0)
  })

  it('getProjectStats returns stored stats', async () => {
    repo.setProjectStats('p1', {
      taskCount: 10,
      tasksByStatus: { todo: 3, 'in-progress': 4, done: 3 },
      completionPercent: 30,
      commentCount: 15,
      attachmentCount: 5,
    })

    const stats = await repo.getProjectStats('p1')
    expect(stats.taskCount).toBe(10)
    expect(stats.tasksByStatus).toEqual({ todo: 3, 'in-progress': 4, done: 3 })
    expect(stats.completionPercent).toBe(30)
  })

  it('different workspaces have independent stats', async () => {
    repo.setWorkspaceStats('ws1', {
      memberCount: 5,
      projectCount: 3,
      taskCount: 20,
      openTasks: 12,
      completedTasks: 8,
      channelCount: 2,
    })
    repo.setWorkspaceStats('ws2', {
      memberCount: 10,
      projectCount: 1,
      taskCount: 5,
      openTasks: 5,
      completedTasks: 0,
      channelCount: 1,
    })

    const stats1 = await repo.getWorkspaceStats('ws1')
    const stats2 = await repo.getWorkspaceStats('ws2')

    expect(stats1.memberCount).toBe(5)
    expect(stats2.memberCount).toBe(10)
  })

  it('different projects have independent stats', async () => {
    repo.setProjectStats('p1', {
      taskCount: 10,
      tasksByStatus: { done: 10 },
      completionPercent: 100,
      commentCount: 20,
      attachmentCount: 3,
    })
    repo.setProjectStats('p2', {
      taskCount: 0,
      tasksByStatus: {},
      completionPercent: 0,
      commentCount: 0,
      attachmentCount: 0,
    })

    const stats1 = await repo.getProjectStats('p1')
    const stats2 = await repo.getProjectStats('p2')

    expect(stats1.completionPercent).toBe(100)
    expect(stats2.completionPercent).toBe(0)
  })
})
