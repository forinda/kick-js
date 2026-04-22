import { describe, it, expect, beforeEach } from 'vitest'
import type { Types } from 'mongoose'
import type { IProjectRepository } from '../domain/repositories/project.repository'
import type { ProjectEntity } from '../domain/entities/project.entity'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryProjectRepository implements IProjectRepository {
  private projects: ProjectEntity[] = []
  private counter = 0

  private fakeId(): Types.ObjectId {
    this.counter++
    return `p${this.counter}` as unknown as Types.ObjectId
  }

  async findById(id: string) {
    return this.projects.find((p) => String(p._id) === id) ?? null
  }

  async findByWorkspace(workspaceId: string) {
    return this.projects.filter((p) => String(p.workspaceId) === workspaceId)
  }

  async findByKeyAndWorkspace(key: string, workspaceId: string) {
    return (
      this.projects.find(
        (p) => p.key === key && String(p.workspaceId) === workspaceId,
      ) ?? null
    )
  }

  async create(data: Partial<ProjectEntity>) {
    const project: ProjectEntity = {
      _id: this.fakeId(),
      workspaceId: data.workspaceId!,
      name: data.name!,
      key: data.key!,
      description: data.description,
      statusColumns: data.statusColumns ?? [
        { name: 'To Do', order: 0, color: '#ccc' },
        { name: 'In Progress', order: 1, color: '#09f' },
        { name: 'Done', order: 2, color: '#0c0' },
      ],
      taskCounter: 0,
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.projects.push(project)
    return project
  }

  async update(id: string, data: Partial<ProjectEntity>) {
    const project = this.projects.find((p) => String(p._id) === id)
    if (!project) return null
    Object.assign(project, data, { updatedAt: new Date() })
    return project
  }

  async delete(id: string) {
    const len = this.projects.length
    this.projects = this.projects.filter((p) => String(p._id) !== id)
    return this.projects.length < len
  }

  async incrementTaskCounter(projectId: string) {
    const project = this.projects.find((p) => String(p._id) === projectId)
    if (!project) throw new Error('Project not found')
    project.taskCounter++
    return project.taskCounter
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryProjectRepository', () => {
  let repo: IProjectRepository

  beforeEach(() => {
    repo = new InMemoryProjectRepository()
  })

  it('create stores a project and returns it with an _id', async () => {
    const project = await repo.create({
      workspaceId: 'ws1' as unknown as Types.ObjectId,
      name: 'My Project',
      key: 'MP',
    })

    expect(project._id).toBeDefined()
    expect(project.name).toBe('My Project')
    expect(project.key).toBe('MP')
    expect(project.taskCounter).toBe(0)
    expect(project.isArchived).toBe(false)
  })

  it('findById returns the correct project', async () => {
    const created = await repo.create({
      workspaceId: 'ws1' as unknown as Types.ObjectId,
      name: 'Find Me',
      key: 'FM',
    })
    const found = await repo.findById(String(created._id))

    expect(found).not.toBeNull()
    expect(found!.name).toBe('Find Me')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByWorkspace returns projects for a given workspace', async () => {
    const wsId = 'ws1' as unknown as Types.ObjectId
    await repo.create({ workspaceId: wsId, name: 'P1', key: 'P1' })
    await repo.create({ workspaceId: wsId, name: 'P2', key: 'P2' })
    await repo.create({
      workspaceId: 'ws2' as unknown as Types.ObjectId,
      name: 'P3',
      key: 'P3',
    })

    const result = await repo.findByWorkspace('ws1')
    expect(result).toHaveLength(2)
  })

  it('findByKeyAndWorkspace returns the correct project', async () => {
    const wsId = 'ws1' as unknown as Types.ObjectId
    await repo.create({ workspaceId: wsId, name: 'Key Test', key: 'KT' })

    const found = await repo.findByKeyAndWorkspace('KT', 'ws1')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('Key Test')
  })

  it('update modifies project fields', async () => {
    const project = await repo.create({
      workspaceId: 'ws1' as unknown as Types.ObjectId,
      name: 'Old Name',
      key: 'ON',
    })
    const updated = await repo.update(String(project._id), { name: 'New Name' })

    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('New Name')
    expect(updated!.key).toBe('ON')
  })

  it('delete removes the project', async () => {
    const project = await repo.create({
      workspaceId: 'ws1' as unknown as Types.ObjectId,
      name: 'Delete Me',
      key: 'DM',
    })
    const deleted = await repo.delete(String(project._id))
    expect(deleted).toBe(true)

    const found = await repo.findById(String(project._id))
    expect(found).toBeNull()
  })

  it('incrementTaskCounter increments and returns the new count', async () => {
    const project = await repo.create({
      workspaceId: 'ws1' as unknown as Types.ObjectId,
      name: 'Counter',
      key: 'CTR',
    })
    const count1 = await repo.incrementTaskCounter(String(project._id))
    const count2 = await repo.incrementTaskCounter(String(project._id))

    expect(count1).toBe(1)
    expect(count2).toBe(2)
  })
})
