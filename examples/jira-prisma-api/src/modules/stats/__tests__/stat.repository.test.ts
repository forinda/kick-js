import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IStatsRepository,
  WorkspaceStats,
  ProjectStats,
} from '../domain/repositories/stat.repository'

// ── In-memory implementation ─────────────────────────────────────────

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

  it('getWorkspaceStats returns default stats for unknown workspace', async () => {
    const stats = await repo.getWorkspaceStats('unknown')

    expect(stats.memberCount).toBe(0)
    expect(stats.projectCount).toBe(0)
    expect(stats.taskCount).toBe(0)
  })

  it('getWorkspaceStats returns configured stats', async () => {
    repo.setWorkspaceStats('ws1', {
      memberCount: 5,
      projectCount: 3,
      taskCount: 42,
      openTasks: 20,
      completedTasks: 22,
      channelCount: 2,
    })

    const stats = await repo.getWorkspaceStats('ws1')

    expect(stats.memberCount).toBe(5)
    expect(stats.projectCount).toBe(3)
    expect(stats.taskCount).toBe(42)
    expect(stats.openTasks).toBe(20)
    expect(stats.completedTasks).toBe(22)
  })

  it('getProjectStats returns default stats for unknown project', async () => {
    const stats = await repo.getProjectStats('unknown')

    expect(stats.taskCount).toBe(0)
    expect(stats.completionPercent).toBe(0)
  })

  it('getProjectStats returns configured stats', async () => {
    repo.setProjectStats('p1', {
      taskCount: 10,
      tasksByStatus: { todo: 3, in_progress: 4, done: 3 },
      completionPercent: 30,
      commentCount: 15,
      attachmentCount: 5,
    })

    const stats = await repo.getProjectStats('p1')

    expect(stats.taskCount).toBe(10)
    expect(stats.tasksByStatus.todo).toBe(3)
    expect(stats.completionPercent).toBe(30)
  })

  it('getWorkspaceStats and getProjectStats are independent', async () => {
    repo.setWorkspaceStats('ws1', {
      memberCount: 10,
      projectCount: 2,
      taskCount: 50,
      openTasks: 30,
      completedTasks: 20,
      channelCount: 3,
    })

    const wsStats = await repo.getWorkspaceStats('ws1')
    const projStats = await repo.getProjectStats('p1')

    expect(wsStats.memberCount).toBe(10)
    expect(projStats.taskCount).toBe(0) // no project stats set
  })
})
