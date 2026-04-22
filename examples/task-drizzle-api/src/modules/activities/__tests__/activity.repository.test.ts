import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IActivityRepository,
  Activity,
  NewActivity,
} from '../domain/repositories/activity.repository'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryActivityRepository implements IActivityRepository {
  private activities: Activity[] = []

  async findPaginated(
    parsed: { pagination?: { page?: number; limit?: number } },
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
    expect(activity.workspaceId).toBe('ws1')
    expect(activity.action).toBe('task.created')
  })

  it('create sets nullable fields to null when omitted', async () => {
    const activity = await repo.create({
      workspaceId: 'ws1',
      actorId: 'u1',
      action: 'project.updated',
    })

    expect(activity.projectId).toBeNull()
    expect(activity.taskId).toBeNull()
    expect(activity.changes).toBeNull()
  })

  it('create stores changes as JSON', async () => {
    const changes = { title: { from: 'Old', to: 'New' } }
    const activity = await repo.create({
      workspaceId: 'ws1',
      actorId: 'u1',
      action: 'task.updated',
      changes,
    })

    expect(activity.changes).toEqual(changes)
  })

  it('findPaginated filters by workspaceId', async () => {
    await repo.create({ workspaceId: 'ws1', actorId: 'u1', action: 'task.created' })
    await repo.create({ workspaceId: 'ws2', actorId: 'u1', action: 'task.deleted' })
    await repo.create({ workspaceId: 'ws1', actorId: 'u2', action: 'comment.added' })

    const result = await repo.findPaginated({}, { workspaceId: 'ws1' })
    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(2)
  })

  it('findPaginated filters by projectId scope', async () => {
    await repo.create({ workspaceId: 'ws1', projectId: 'p1', actorId: 'u1', action: 'a' })
    await repo.create({ workspaceId: 'ws1', projectId: 'p2', actorId: 'u1', action: 'b' })

    const result = await repo.findPaginated({}, { workspaceId: 'ws1', projectId: 'p1' })
    expect(result.data).toHaveLength(1)
    expect(result.data[0].action).toBe('a')
  })

  it('findPaginated filters by taskId scope', async () => {
    await repo.create({ workspaceId: 'ws1', taskId: 't1', actorId: 'u1', action: 'x' })
    await repo.create({ workspaceId: 'ws1', taskId: 't2', actorId: 'u1', action: 'y' })

    const result = await repo.findPaginated({}, { workspaceId: 'ws1', taskId: 't1' })
    expect(result.data).toHaveLength(1)
    expect(result.data[0].action).toBe('x')
  })

  it('findPaginated respects pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await repo.create({ workspaceId: 'ws1', actorId: 'u1', action: `action-${i}` })
    }

    const result = await repo.findPaginated(
      { pagination: { page: 2, limit: 2 } },
      { workspaceId: 'ws1' },
    )
    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(5)
  })
})
