import { describe, it, expect, beforeEach } from 'vitest'
import type { IWorkspaceRepository } from '../domain/repositories/workspace.repository'

// ── In-memory implementation ─────────────────────────────────────────

type Workspace = {
  id: string
  name: string
  slug: string
  description: string | null
  ownerId: string
  logoUrl: string | null
  createdAt: Date
  updatedAt: Date
}

class InMemoryWorkspaceRepository implements IWorkspaceRepository {
  private workspaces: Workspace[] = []

  async findById(id: string) {
    return this.workspaces.find((w) => w.id === id) ?? null
  }

  async findBySlug(slug: string) {
    return this.workspaces.find((w) => w.slug === slug) ?? null
  }

  async findForUser(_userId: string) {
    return this.workspaces
  }

  async findPaginated() {
    return { data: this.workspaces, total: this.workspaces.length }
  }

  async create(dto: any): Promise<Workspace> {
    const workspace: Workspace = {
      id: `w${this.workspaces.length + 1}`,
      name: dto.name,
      slug: dto.slug ?? dto.name.toLowerCase().replace(/\s+/g, '-'),
      description: dto.description ?? null,
      ownerId: dto.ownerId ?? 'u1',
      logoUrl: dto.logoUrl ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.workspaces.push(workspace)
    return workspace
  }

  async update(id: string, dto: any): Promise<Workspace> {
    const workspace = this.workspaces.find((w) => w.id === id)
    if (!workspace) throw new Error('Not found')
    Object.assign(workspace, dto, { updatedAt: new Date() })
    return workspace
  }

  async delete(id: string) {
    this.workspaces = this.workspaces.filter((w) => w.id !== id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryWorkspaceRepository', () => {
  let repo: IWorkspaceRepository

  beforeEach(() => {
    repo = new InMemoryWorkspaceRepository()
  })

  it('create stores a workspace and returns it', async () => {
    const ws = await repo.create({ name: 'Acme Corp', ownerId: 'u1' })
    expect(ws.id).toBeDefined()
    expect(ws.name).toBe('Acme Corp')
    expect(ws.slug).toBe('acme-corp')
  })

  it('findById returns the correct workspace', async () => {
    const created = await repo.create({ name: 'Test WS', ownerId: 'u1' })
    const found = await repo.findById(created.id)
    expect(found).not.toBeNull()
    expect(found!.name).toBe('Test WS')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findBySlug returns the correct workspace', async () => {
    await repo.create({ name: 'My Team', slug: 'my-team', ownerId: 'u1' })
    const found = await repo.findBySlug('my-team')
    expect(found).not.toBeNull()
    expect(found!.name).toBe('My Team')
  })

  it('update modifies workspace fields', async () => {
    const ws = await repo.create({ name: 'Old Name', ownerId: 'u1' })
    const updated = await repo.update(ws.id, { name: 'New Name' })
    expect(updated.name).toBe('New Name')
  })

  it('delete removes the workspace', async () => {
    const ws = await repo.create({ name: 'Delete Me', ownerId: 'u1' })
    await repo.delete(ws.id)
    const found = await repo.findById(ws.id)
    expect(found).toBeNull()
  })

  it('findPaginated returns all workspaces', async () => {
    await repo.create({ name: 'WS1', ownerId: 'u1' })
    await repo.create({ name: 'WS2', ownerId: 'u1' })
    const result = await repo.findPaginated({} as any)
    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(2)
  })
})
