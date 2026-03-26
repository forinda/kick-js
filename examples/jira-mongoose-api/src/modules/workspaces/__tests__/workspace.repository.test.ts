import { describe, it, expect, beforeEach } from 'vitest'
import type { Types } from 'mongoose'
import type { IWorkspaceRepository } from '../domain/repositories/workspace.repository'
import type { WorkspaceEntity } from '../domain/entities/workspace.entity'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryWorkspaceRepository implements IWorkspaceRepository {
  private workspaces: WorkspaceEntity[] = []
  private counter = 0

  private fakeId(): Types.ObjectId {
    this.counter++
    return `ws${this.counter}` as unknown as Types.ObjectId
  }

  async findById(id: string) {
    return this.workspaces.find((w) => String(w._id) === id) ?? null
  }

  async findBySlug(slug: string) {
    return this.workspaces.find((w) => w.slug === slug) ?? null
  }

  async create(data: Partial<WorkspaceEntity>) {
    const workspace: WorkspaceEntity = {
      _id: this.fakeId(),
      name: data.name!,
      slug: data.slug!,
      description: data.description,
      ownerId: data.ownerId!,
      logoUrl: data.logoUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.workspaces.push(workspace)
    return workspace
  }

  async update(id: string, data: Partial<WorkspaceEntity>) {
    const workspace = this.workspaces.find((w) => String(w._id) === id)
    if (!workspace) return null
    Object.assign(workspace, data, { updatedAt: new Date() })
    return workspace
  }

  async delete(id: string) {
    const len = this.workspaces.length
    this.workspaces = this.workspaces.filter((w) => String(w._id) !== id)
    return this.workspaces.length < len
  }

  async findByOwner(ownerId: string) {
    return this.workspaces.filter((w) => String(w.ownerId) === ownerId)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryWorkspaceRepository', () => {
  let repo: IWorkspaceRepository

  beforeEach(() => {
    repo = new InMemoryWorkspaceRepository()
  })

  it('create stores a workspace and returns it with an _id', async () => {
    const ws = await repo.create({
      name: 'Acme Corp',
      slug: 'acme-corp',
      ownerId: 'owner1' as unknown as Types.ObjectId,
    })

    expect(ws._id).toBeDefined()
    expect(ws.name).toBe('Acme Corp')
    expect(ws.slug).toBe('acme-corp')
  })

  it('findById returns the correct workspace', async () => {
    const created = await repo.create({
      name: 'Test WS',
      slug: 'test-ws',
      ownerId: 'owner1' as unknown as Types.ObjectId,
    })
    const found = await repo.findById(String(created._id))

    expect(found).not.toBeNull()
    expect(found!.name).toBe('Test WS')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findBySlug returns the correct workspace', async () => {
    await repo.create({
      name: 'Slug Test',
      slug: 'slug-test',
      ownerId: 'owner1' as unknown as Types.ObjectId,
    })
    const found = await repo.findBySlug('slug-test')

    expect(found).not.toBeNull()
    expect(found!.name).toBe('Slug Test')
  })

  it('findByOwner returns all workspaces for an owner', async () => {
    const ownerId = 'owner1' as unknown as Types.ObjectId
    await repo.create({ name: 'WS1', slug: 'ws1', ownerId })
    await repo.create({ name: 'WS2', slug: 'ws2', ownerId })
    await repo.create({
      name: 'WS3',
      slug: 'ws3',
      ownerId: 'owner2' as unknown as Types.ObjectId,
    })

    const result = await repo.findByOwner('owner1')
    expect(result).toHaveLength(2)
  })

  it('update modifies workspace fields', async () => {
    const ws = await repo.create({
      name: 'Old Name',
      slug: 'old-name',
      ownerId: 'owner1' as unknown as Types.ObjectId,
    })
    const updated = await repo.update(String(ws._id), { name: 'New Name' })

    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('New Name')
    expect(updated!.slug).toBe('old-name')
  })

  it('delete removes the workspace and returns true', async () => {
    const ws = await repo.create({
      name: 'Delete Me',
      slug: 'delete-me',
      ownerId: 'owner1' as unknown as Types.ObjectId,
    })
    const deleted = await repo.delete(String(ws._id))
    expect(deleted).toBe(true)

    const found = await repo.findById(String(ws._id))
    expect(found).toBeNull()
  })
})
