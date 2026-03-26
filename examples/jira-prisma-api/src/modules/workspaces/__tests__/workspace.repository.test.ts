import { describe, it, expect, beforeEach } from 'vitest'
import type { IWorkspaceRepository } from '../domain/repositories/workspace.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryWorkspaceRepository implements IWorkspaceRepository {
  private workspaces: any[] = []

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
  async create(dto: any) {
    const ws = {
      id: `ws${this.workspaces.length + 1}`,
      name: dto.name,
      slug: dto.slug ?? dto.name.toLowerCase().replace(/\s+/g, '-'),
      description: dto.description ?? null,
      ownerId: dto.ownerId,
      logoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.workspaces.push(ws)
    return ws
  }
  async update(id: string, dto: any) {
    const ws = this.workspaces.find((w) => w.id === id)
    if (!ws) throw new Error('Not found')
    Object.assign(ws, dto, { updatedAt: new Date() })
    return ws
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

  it('create stores a workspace and returns it with an id', async () => {
    const ws = await repo.create({ name: 'Acme Corp', ownerId: 'u1' })

    expect(ws.id).toBeDefined()
    expect(ws.name).toBe('Acme Corp')
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
    await repo.create({ name: 'My Workspace', slug: 'my-workspace', ownerId: 'u1' })
    const found = await repo.findBySlug('my-workspace')

    expect(found).not.toBeNull()
    expect(found!.name).toBe('My Workspace')
  })

  it('update modifies workspace fields', async () => {
    const ws = await repo.create({ name: 'Old Name', ownerId: 'u1' })
    const updated = await repo.update(ws.id, { name: 'New Name' })

    expect(updated.name).toBe('New Name')
  })

  it('delete removes the workspace', async () => {
    const ws = await repo.create({ name: 'Temp', ownerId: 'u1' })
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
