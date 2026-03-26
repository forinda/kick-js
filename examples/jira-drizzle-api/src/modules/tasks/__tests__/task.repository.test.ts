import { describe, it, expect, beforeEach } from 'vitest'
import type { ITaskRepository, Task, NewTask } from '../domain/repositories/task.repository'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryTaskRepository implements ITaskRepository {
  private tasks: Task[] = []

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
    const task: Task = {
      id: `t${this.tasks.length + 1}`,
      projectId: dto.projectId,
      workspaceId: dto.workspaceId,
      key: dto.key,
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status ?? 'todo',
      priority: dto.priority ?? 'none',
      reporterId: dto.reporterId,
      parentTaskId: dto.parentTaskId ?? null,
      dueDate: dto.dueDate ?? null,
      estimatePoints: dto.estimatePoints ?? null,
      orderIndex: dto.orderIndex ?? 0,
      attachmentCount: dto.attachmentCount ?? 0,
      commentCount: dto.commentCount ?? 0,
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
      key: 'ALP-1',
      title: 'First task',
      reporterId: 'u1',
    })

    expect(task.id).toBeDefined()
    expect(task.title).toBe('First task')
    expect(task.status).toBe('todo')
    expect(task.priority).toBe('none')
  })

  it('findById returns the correct task', async () => {
    const created = await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'ALP-2',
      title: 'Find me',
      reporterId: 'u1',
    })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.title).toBe('Find me')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByProject returns tasks for a given project', async () => {
    await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'A-1',
      title: 'T1',
      reporterId: 'u1',
    })
    await repo.create({
      projectId: 'p2',
      workspaceId: 'ws1',
      key: 'B-1',
      title: 'T2',
      reporterId: 'u1',
    })
    await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'A-2',
      title: 'T3',
      reporterId: 'u1',
    })

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
      title: 'Old',
      reporterId: 'u1',
    })
    const updated = await repo.update(task.id, { title: 'New', status: 'in_progress' })

    expect(updated.title).toBe('New')
    expect(updated.status).toBe('in_progress')
  })

  it('delete removes the task', async () => {
    const task = await repo.create({
      projectId: 'p1',
      workspaceId: 'ws1',
      key: 'A-1',
      title: 'Remove me',
      reporterId: 'u1',
    })
    await repo.delete(task.id)

    const found = await repo.findById(task.id)
    expect(found).toBeNull()
  })
})
