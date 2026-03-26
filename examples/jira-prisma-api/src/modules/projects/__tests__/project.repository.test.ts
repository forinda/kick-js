import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IProjectRepository,
  NewProject,
} from '../domain/repositories/project.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryProjectRepository implements IProjectRepository {
  private projects: any[] = []
  private counter = 0

  async findById(id: string) {
    return this.projects.find((p) => p.id === id) ?? null
  }
  async findByWorkspace(workspaceId: string) {
    return this.projects.filter((p) => p.workspaceId === workspaceId)
  }
  async findPaginated() {
    return { data: this.projects, total: this.projects.length }
  }
  async create(dto: NewProject) {
    const project = {
      id: `p${this.projects.length + 1}`,
      workspaceId: dto.workspaceId,
      name: dto.name,
      key: dto.key,
      description: dto.description ?? null,
      leadId: dto.leadId ?? null,
      taskCounter: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.projects.push(project)
    return project
  }
  async update(id: string, dto: Partial<NewProject>) {
    const project = this.projects.find((p) => p.id === id)
    if (!project) throw new Error('Not found')
    Object.assign(project, dto, { updatedAt: new Date() })
    return project
  }
  async incrementTaskCounter(id: string) {
    const project = this.projects.find((p) => p.id === id)
    if (!project) throw new Error('Not found')
    project.taskCounter += 1
    return { taskCounter: project.taskCounter, key: project.key }
  }
  async delete(id: string) {
    this.projects = this.projects.filter((p) => p.id !== id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryProjectRepository', () => {
  let repo: IProjectRepository

  beforeEach(() => {
    repo = new InMemoryProjectRepository()
  })

  it('create stores a project and returns it with an id', async () => {
    const project = await repo.create({
      workspaceId: 'ws1',
      name: 'Alpha',
      key: 'ALPHA',
    })

    expect(project.id).toBeDefined()
    expect(project.name).toBe('Alpha')
    expect(project.key).toBe('ALPHA')
  })

  it('findById returns the correct project', async () => {
    const created = await repo.create({ workspaceId: 'ws1', name: 'Beta', key: 'BETA' })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.name).toBe('Beta')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByWorkspace filters by workspace', async () => {
    await repo.create({ workspaceId: 'ws1', name: 'P1', key: 'P1' })
    await repo.create({ workspaceId: 'ws2', name: 'P2', key: 'P2' })
    await repo.create({ workspaceId: 'ws1', name: 'P3', key: 'P3' })

    const results = await repo.findByWorkspace('ws1')
    expect(results).toHaveLength(2)
  })

  it('update modifies project fields', async () => {
    const project = await repo.create({ workspaceId: 'ws1', name: 'Old', key: 'OLD' })
    const updated = await repo.update(project.id, { name: 'New' })

    expect(updated.name).toBe('New')
    expect(updated.key).toBe('OLD')
  })

  it('incrementTaskCounter bumps counter', async () => {
    const project = await repo.create({ workspaceId: 'ws1', name: 'Proj', key: 'PRJ' })
    const result = await repo.incrementTaskCounter(project.id)

    expect(result.taskCounter).toBe(1)
    expect(result.key).toBe('PRJ')
  })

  it('delete removes the project', async () => {
    const project = await repo.create({ workspaceId: 'ws1', name: 'Temp', key: 'TMP' })
    await repo.delete(project.id)

    const found = await repo.findById(project.id)
    expect(found).toBeNull()
  })
})
