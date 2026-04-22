import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IWorkspaceRepository,
  Workspace,
  NewWorkspace,
} from '../domain/repositories/workspace.repository'

// ── In-memory implementation for testing ─────────────────────────────

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

  async create(dto: NewWorkspace) {
    const workspace: Workspace = {
      id: `ws${this.workspaces.length + 1}`,
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      ownerId: dto.ownerId,
      logoUrl: dto.logoUrl ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.workspaces.push(workspace)
    return workspace
  }

  async update(id: string, dto: Partial<NewWorkspace>) {
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

  it('create stores a workspace and returns it with an id', async () => {
    const workspace = await repo.create({
      name: 'Acme Corp',
      slug: 'acme-corp',
      ownerId: 'u1',
    })

    expect(workspace.id).toBeDefined()
    expect(workspace.name).toBe('Acme Corp')
    expect(workspace.slug).toBe('acme-corp')
    expect(workspace.logoUrl).toBeNull()
  })

  it('findById returns the correct workspace', async () => {
    const created = await repo.create({ name: 'Test WS', slug: 'test-ws', ownerId: 'u1' })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.name).toBe('Test WS')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findBySlug returns the correct workspace', async () => {
    await repo.create({ name: 'Slug Test', slug: 'slug-test', ownerId: 'u1' })
    const found = await repo.findBySlug('slug-test')

    expect(found).not.toBeNull()
    expect(found!.name).toBe('Slug Test')
  })

  it('findBySlug returns null for unknown slug', async () => {
    const found = await repo.findBySlug('unknown-slug')
    expect(found).toBeNull()
  })

  it('update modifies workspace fields', async () => {
    const ws = await repo.create({ name: 'Old', slug: 'old', ownerId: 'u1' })
    const updated = await repo.update(ws.id, { name: 'New' })

    expect(updated.name).toBe('New')
    expect(updated.slug).toBe('old')
  })

  it('delete removes the workspace', async () => {
    const ws = await repo.create({ name: 'Temp', slug: 'temp', ownerId: 'u1' })
    await repo.delete(ws.id)

    const found = await repo.findById(ws.id)
    expect(found).toBeNull()
  })
})
