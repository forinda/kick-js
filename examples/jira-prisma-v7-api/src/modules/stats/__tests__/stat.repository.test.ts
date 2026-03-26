import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IStatsRepository,
  WorkspaceStats,
  ProjectStats,
} from '../domain/repositories/stat.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryStatsRepository implements IStatsRepository {
  private workspaceStatsMap: Record<string, WorkspaceStats> = {
    w1: {
      memberCount: 5,
      projectCount: 3,
      taskCount: 42,
      openTasks: 15,
      completedTasks: 27,
      channelCount: 4,
    },
  }

  private projectStatsMap: Record<string, ProjectStats> = {
    p1: {
      taskCount: 20,
      tasksByStatus: { todo: 5, in_progress: 8, done: 7 },
      completionPercent: 35,
      commentCount: 45,
      attachmentCount: 12,
    },
  }

  async getWorkspaceStats(workspaceId: string): Promise<WorkspaceStats> {
    return (
      this.workspaceStatsMap[workspaceId] ?? {
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
      this.projectStatsMap[projectId] ?? {
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
  let repo: IStatsRepository

  beforeEach(() => {
    repo = new InMemoryStatsRepository()
  })

  it('getWorkspaceStats returns stats for known workspace', async () => {
    const stats = await repo.getWorkspaceStats('w1')
    expect(stats.memberCount).toBe(5)
    expect(stats.projectCount).toBe(3)
    expect(stats.taskCount).toBe(42)
    expect(stats.openTasks).toBe(15)
    expect(stats.completedTasks).toBe(27)
    expect(stats.channelCount).toBe(4)
  })

  it('getWorkspaceStats returns zero stats for unknown workspace', async () => {
    const stats = await repo.getWorkspaceStats('unknown')
    expect(stats.memberCount).toBe(0)
    expect(stats.taskCount).toBe(0)
  })

  it('getProjectStats returns stats for known project', async () => {
    const stats = await repo.getProjectStats('p1')
    expect(stats.taskCount).toBe(20)
    expect(stats.tasksByStatus).toHaveProperty('todo', 5)
    expect(stats.completionPercent).toBe(35)
    expect(stats.commentCount).toBe(45)
    expect(stats.attachmentCount).toBe(12)
  })

  it('getProjectStats returns zero stats for unknown project', async () => {
    const stats = await repo.getProjectStats('unknown')
    expect(stats.taskCount).toBe(0)
    expect(stats.completionPercent).toBe(0)
  })

  it('workspace stats fields are all numbers', async () => {
    const stats = await repo.getWorkspaceStats('w1')
    for (const value of Object.values(stats)) {
      expect(typeof value).toBe('number')
    }
  })
})
