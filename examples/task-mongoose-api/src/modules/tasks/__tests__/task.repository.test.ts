import { describe, it, expect, beforeEach } from 'vitest'
import type { Types } from 'mongoose'
import type { ITaskRepository } from '../domain/repositories/task.repository'
import type { TaskEntity } from '../domain/entities/task.entity'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryTaskRepository implements ITaskRepository {
  private tasks: TaskEntity[] = []
  private counter = 0

  private fakeId(): Types.ObjectId {
    this.counter++
    return `t${this.counter}` as unknown as Types.ObjectId
  }

  async findById(id: string) {
    return this.tasks.find((t) => String(t._id) === id) ?? null
  }

  async findByProject(projectId: string) {
    return this.tasks.filter((t) => String(t.projectId) === projectId)
  }

  async findByKey(key: string) {
    return this.tasks.find((t) => t.key === key) ?? null
  }

  async create(data: Partial<TaskEntity>) {
    const task: TaskEntity = {
      _id: this.fakeId(),
      projectId: data.projectId!,
      workspaceId: data.workspaceId!,
      key: data.key ?? `TASK-${this.counter}`,
      title: data.title!,
      description: data.description,
      status: data.status ?? 'To Do',
      priority: data.priority ?? 'medium',
      assigneeIds: data.assigneeIds ?? [],
      reporterId: data.reporterId!,
      labelIds: data.labelIds ?? [],
      parentTaskId: data.parentTaskId,
      dueDate: data.dueDate,
      estimatePoints: data.estimatePoints,
      orderIndex: data.orderIndex ?? 0,
      attachmentCount: 0,
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.tasks.push(task)
    return task
  }

  async update(id: string, data: Partial<TaskEntity>) {
    const task = this.tasks.find((t) => String(t._id) === id)
    if (!task) return null
    Object.assign(task, data, { updatedAt: new Date() })
    return task
  }

  async delete(id: string) {
    const len = this.tasks.length
    this.tasks = this.tasks.filter((t) => String(t._id) !== id)
    return this.tasks.length < len
  }

  async findPaginated() {
    return { data: this.tasks, total: this.tasks.length }
  }

  async findOverdue() {
    const now = new Date()
    return this.tasks.filter((t) => t.dueDate && t.dueDate < now && t.status !== 'Done')
  }

  async countByStatus(projectId: string) {
    const counts: Record<string, number> = {}
    for (const t of this.tasks) {
      if (String(t.projectId) === projectId) {
        counts[t.status] = (counts[t.status] ?? 0) + 1
      }
    }
    return counts
  }

  async findSubtasks(parentTaskId: string) {
    return this.tasks.filter((t) => String(t.parentTaskId) === parentTaskId)
  }

  async incrementCommentCount(taskId: string, amount: number) {
    const task = this.tasks.find((t) => String(t._id) === taskId)
    if (task) task.commentCount += amount
  }

  async incrementAttachmentCount(taskId: string, amount: number) {
    const task = this.tasks.find((t) => String(t._id) === taskId)
    if (task) task.attachmentCount += amount
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryTaskRepository', () => {
  let repo: ITaskRepository

  const projectId = 'p1' as unknown as Types.ObjectId
  const workspaceId = 'ws1' as unknown as Types.ObjectId
  const reporterId = 'u1' as unknown as Types.ObjectId

  beforeEach(() => {
    repo = new InMemoryTaskRepository()
  })

  it('create stores a task and returns it with an _id', async () => {
    const task = await repo.create({
      projectId,
      workspaceId,
      title: 'Fix bug',
      key: 'P1-1',
      reporterId,
    })

    expect(task._id).toBeDefined()
    expect(task.title).toBe('Fix bug')
    expect(task.status).toBe('To Do')
    expect(task.priority).toBe('medium')
  })

  it('findById returns the correct task', async () => {
    const created = await repo.create({
      projectId,
      workspaceId,
      title: 'Find Me',
      reporterId,
    })
    const found = await repo.findById(String(created._id))

    expect(found).not.toBeNull()
    expect(found!.title).toBe('Find Me')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByProject returns tasks for a given project', async () => {
    await repo.create({ projectId, workspaceId, title: 'T1', reporterId })
    await repo.create({ projectId, workspaceId, title: 'T2', reporterId })
    await repo.create({
      projectId: 'p2' as unknown as Types.ObjectId,
      workspaceId,
      title: 'T3',
      reporterId,
    })

    const result = await repo.findByProject('p1')
    expect(result).toHaveLength(2)
  })

  it('findByKey returns the correct task', async () => {
    await repo.create({
      projectId,
      workspaceId,
      title: 'Key Task',
      key: 'P1-42',
      reporterId,
    })
    const found = await repo.findByKey('P1-42')

    expect(found).not.toBeNull()
    expect(found!.title).toBe('Key Task')
  })

  it('update modifies task fields', async () => {
    const task = await repo.create({
      projectId,
      workspaceId,
      title: 'Old Title',
      reporterId,
    })
    const updated = await repo.update(String(task._id), { title: 'New Title' })

    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('New Title')
  })

  it('delete removes the task', async () => {
    const task = await repo.create({
      projectId,
      workspaceId,
      title: 'Delete Me',
      reporterId,
    })
    const deleted = await repo.delete(String(task._id))
    expect(deleted).toBe(true)

    const found = await repo.findById(String(task._id))
    expect(found).toBeNull()
  })

  it('countByStatus returns correct counts', async () => {
    await repo.create({ projectId, workspaceId, title: 'T1', status: 'To Do', reporterId })
    await repo.create({ projectId, workspaceId, title: 'T2', status: 'To Do', reporterId })
    await repo.create({ projectId, workspaceId, title: 'T3', status: 'Done', reporterId })

    const counts = await repo.countByStatus('p1')
    expect(counts['To Do']).toBe(2)
    expect(counts['Done']).toBe(1)
  })

  it('findSubtasks returns child tasks', async () => {
    const parent = await repo.create({
      projectId,
      workspaceId,
      title: 'Parent',
      reporterId,
    })
    await repo.create({
      projectId,
      workspaceId,
      title: 'Child 1',
      parentTaskId: parent._id,
      reporterId,
    })
    await repo.create({
      projectId,
      workspaceId,
      title: 'Child 2',
      parentTaskId: parent._id,
      reporterId,
    })

    const subtasks = await repo.findSubtasks(String(parent._id))
    expect(subtasks).toHaveLength(2)
  })

  it('incrementCommentCount updates the count', async () => {
    const task = await repo.create({
      projectId,
      workspaceId,
      title: 'Commentable',
      reporterId,
    })
    await repo.incrementCommentCount(String(task._id), 3)

    const found = await repo.findById(String(task._id))
    expect(found!.commentCount).toBe(3)
  })
})
