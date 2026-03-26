import { describe, it, expect, beforeEach } from 'vitest'
import type { ITaskRepository, NewTask } from '../domain/repositories/task.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryTaskRepository implements ITaskRepository {
  private tasks: any[] = []

  async findById(id: string) {
    return this.tasks.find((t) => t.id === id) ?? null
  }
  async findByProject(projectId: string) {
    return this.tasks.filter((t) => t.projectId === projectId)
  }
  async findPaginated() {
    return { data: this.tasks, total: this.tasks.length }
  }
  async findSubtasks(parentTaskId: string) {
    return this.tasks.filter((t) => t.parentTaskId === parentTaskId)
  }
  async create(dto: NewTask) {
    const task = {
      id: `t${this.tasks.length + 1}`,
      projectId: dto.projectId,
      workspaceId: dto.workspaceId,
      key: dto.key,
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status ?? 'todo',
      priority: dto.priority ?? 'medium',
      reporterId: dto.reporterId,
      parentTaskId: dto.parentTaskId ?? null,
      dueDate: dto.dueDate ?? null,
      estimatePoints: dto.estimatePoints ?? null,
      orderIndex: dto.orderIndex ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.tasks.push(task)
    return task
  }
  async update(id: string, dto: Partial<NewTask>) {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) throw new Error('Not found')
    Object.assign(task, dto, { updatedAt: new Date() })
    return task
  }
  async delete(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryTaskRepository', () => {
  let repo: ITaskRepository

  beforeEach(() => {
    repo = new InMemoryTaskRepository()
  })

  it('create stores a task and returns it with an id', async () => {
    const task = await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'ALPHA-1',
      title: 'First task',
      reporterId: 'u1',
    })

    expect(task.id).toBeDefined()
    expect(task.title).toBe('First task')
    expect(task.key).toBe('ALPHA-1')
  })

  it('findById returns the correct task', async () => {
    const created = await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'ALPHA-2',
      title: 'Second',
      reporterId: 'u1',
    })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.title).toBe('Second')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByProject filters by project', async () => {
    await repo.create({ projectId: 'p1', workspaceId: 'ws1', key: 'A-1', title: 'T1', reporterId: 'u1' })
    await repo.create({ projectId: 'p2', workspaceId: 'ws1', key: 'B-1', title: 'T2', reporterId: 'u1' })
    await repo.create({ projectId: 'p1', workspaceId: 'ws1', key: 'A-2', title: 'T3', reporterId: 'u1' })

    const results = await repo.findByProject('p1')
    expect(results).toHaveLength(2)
  })

  it('findSubtasks returns child tasks', async () => {
    const parent = await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'A-1',
      title: 'Parent',
      reporterId: 'u1',
    })
    await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'A-2',
      title: 'Child',
      reporterId: 'u1',
      parentTaskId: parent.id,
    })

    const subtasks = await repo.findSubtasks(parent.id)
    expect(subtasks).toHaveLength(1)
    expect(subtasks[0].title).toBe('Child')
  })

  it('update modifies task fields', async () => {
    const task = await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'A-1',
      title: 'Original',
      reporterId: 'u1',
    })
    const updated = await repo.update(task.id, { title: 'Updated', status: 'in_progress' })

    expect(updated.title).toBe('Updated')
    expect(updated.status).toBe('in_progress')
  })

  it('delete removes the task', async () => {
    const task = await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'A-1',
      title: 'Temp',
      reporterId: 'u1',
    })
    await repo.delete(task.id)

    const found = await repo.findById(task.id)
    expect(found).toBeNull()
  })
})
