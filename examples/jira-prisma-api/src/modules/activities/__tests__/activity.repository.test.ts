import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IActivityRepository,
  NewActivity,
} from '../domain/repositories/activity.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryActivityRepository implements IActivityRepository {
  private activities: any[] = []

  async findPaginated(
    _parsed: any,
    scope: { workspaceId: string; projectId?: string; taskId?: string },
  ) {
    let filtered = this.activities.filter((a) => a.workspaceId === scope.workspaceId)
    if (scope.projectId) filtered = filtered.filter((a) => a.projectId === scope.projectId)
    if (scope.taskId) filtered = filtered.filter((a) => a.taskId === scope.taskId)
    return { data: filtered, total: filtered.length }
  }

  async create(data: NewActivity) {
    const activity = {
      id: `act${this.activities.length + 1}`,
      workspaceId: data.workspaceId,
      actorId: data.actorId,
      action: data.action,
      projectId: data.projectId ?? null,
      taskId: data.taskId ?? null,
      changes: data.changes ?? null,
      createdAt: new Date(),
    }
    this.activities.push(activity)
    return activity
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryActivityRepository', () => {
  let repo: IActivityRepository

  beforeEach(() => {
    repo = new InMemoryActivityRepository()
  })

  it('create stores an activity and returns it with an id', async () => {
    const activity = await repo.create({
      workspaceId: 'ws1',
      actorId: 'u1',
      action: 'task.created',
    })

    expect(activity.id).toBeDefined()
    expect(activity.action).toBe('task.created')
  })

  it('findPaginated filters by workspace', async () => {
    await repo.create({ workspaceId: 'ws1', actorId: 'u1', action: 'task.created' })
    await repo.create({ workspaceId: 'ws2', actorId: 'u1', action: 'task.updated' })
    await repo.create({ workspaceId: 'ws1', actorId: 'u2', action: 'comment.created' })

    const result = await repo.findPaginated({} as any, { workspaceId: 'ws1' })
    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(2)
  })

  it('findPaginated filters by project scope', async () => {
    await repo.create({ workspaceId: 'ws1', actorId: 'u1', action: 'a', projectId: 'p1' })
    await repo.create({ workspaceId: 'ws1', actorId: 'u1', action: 'b', projectId: 'p2' })
    await repo.create({ workspaceId: 'ws1', actorId: 'u1', action: 'c', projectId: 'p1' })

    const result = await repo.findPaginated({} as any, { workspaceId: 'ws1', projectId: 'p1' })
    expect(result.data).toHaveLength(2)
  })

  it('findPaginated filters by task scope', async () => {
    await repo.create({ workspaceId: 'ws1', actorId: 'u1', action: 'a', taskId: 't1' })
    await repo.create({ workspaceId: 'ws1', actorId: 'u1', action: 'b', taskId: 't2' })

    const result = await repo.findPaginated({} as any, { workspaceId: 'ws1', taskId: 't1' })
    expect(result.data).toHaveLength(1)
  })

  it('create stores changes metadata', async () => {
    const activity = await repo.create({
      workspaceId: 'ws1',
      actorId: 'u1',
      action: 'task.updated',
      changes: { status: { from: 'todo', to: 'in_progress' } },
    })

    expect(activity.changes).toEqual({ status: { from: 'todo', to: 'in_progress' } })
  })
})
