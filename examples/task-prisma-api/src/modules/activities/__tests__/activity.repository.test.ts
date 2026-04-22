import { describe, it, expect, beforeEach } from 'vitest'
import type { IActivityRepository, NewActivity } from '../domain/repositories/activity.repository'

// ── In-memory implementation ─────────────────────────────────────────

type Activity = {
  id: string
  workspaceId: string
  projectId: string | null
  taskId: string | null
  actorId: string
  action: string
  changes: any
  createdAt: Date
}

class InMemoryActivityRepository implements IActivityRepository {
  private activities: Activity[] = []

  async findPaginated(
    _parsed: any,
    scope: { workspaceId: string; projectId?: string; taskId?: string },
  ) {
    let filtered = this.activities.filter((a) => a.workspaceId === scope.workspaceId)
    if (scope.projectId) filtered = filtered.filter((a) => a.projectId === scope.projectId)
    if (scope.taskId) filtered = filtered.filter((a) => a.taskId === scope.taskId)
    return { data: filtered, total: filtered.length }
  }

  async create(dto: NewActivity): Promise<Activity> {
    const activity: Activity = {
      id: `a${this.activities.length + 1}`,
      workspaceId: dto.workspaceId,
      actorId: dto.actorId,
      action: dto.action,
      projectId: dto.projectId ?? null,
      taskId: dto.taskId ?? null,
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

  it('create stores an activity and returns it', async () => {
    const activity = await repo.create({
      workspaceId: 'w1',
      actorId: 'u1',
      action: 'task_created',
    })
    expect(activity.id).toBeDefined()
    expect(activity.action).toBe('task_created')
    expect(activity.workspaceId).toBe('w1')
  })

  it('create stores optional fields', async () => {
    const activity = await repo.create({
      workspaceId: 'w1',
      actorId: 'u1',
      action: 'task_updated',
      projectId: 'p1',
      taskId: 't1',
      changes: { status: 'done' },
    })
    expect(activity.projectId).toBe('p1')
    expect(activity.taskId).toBe('t1')
    expect(activity.changes).toEqual({ status: 'done' })
  })

  it('findPaginated filters by workspace', async () => {
    await repo.create({ workspaceId: 'w1', actorId: 'u1', action: 'a1' })
    await repo.create({ workspaceId: 'w2', actorId: 'u1', action: 'a2' })
    await repo.create({ workspaceId: 'w1', actorId: 'u2', action: 'a3' })

    const result = await repo.findPaginated({} as any, { workspaceId: 'w1' })
    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(2)
  })

  it('findPaginated filters by project within workspace', async () => {
    await repo.create({ workspaceId: 'w1', actorId: 'u1', action: 'a1', projectId: 'p1' })
    await repo.create({ workspaceId: 'w1', actorId: 'u1', action: 'a2', projectId: 'p2' })
    await repo.create({ workspaceId: 'w1', actorId: 'u1', action: 'a3', projectId: 'p1' })

    const result = await repo.findPaginated({} as any, { workspaceId: 'w1', projectId: 'p1' })
    expect(result.data).toHaveLength(2)
  })

  it('findPaginated filters by task within workspace', async () => {
    await repo.create({ workspaceId: 'w1', actorId: 'u1', action: 'a1', taskId: 't1' })
    await repo.create({ workspaceId: 'w1', actorId: 'u1', action: 'a2', taskId: 't2' })

    const result = await repo.findPaginated({} as any, { workspaceId: 'w1', taskId: 't1' })
    expect(result.data).toHaveLength(1)
    expect(result.data[0].action).toBe('a1')
  })
})
