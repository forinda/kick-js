import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IChannelRepository,
  NewChannel,
} from '../domain/repositories/channel.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryChannelRepository implements IChannelRepository {
  private channels: any[] = []

  async findById(id: string) {
    return this.channels.find((c) => c.id === id) ?? null
  }
  async findPaginated(_parsed: any, workspaceId: string) {
    const filtered = this.channels.filter((c) => c.workspaceId === workspaceId)
    return { data: filtered, total: filtered.length }
  }
  async create(data: NewChannel) {
    const channel = {
      id: `ch${this.channels.length + 1}`,
      workspaceId: data.workspaceId,
      name: data.name,
      description: data.description ?? null,
      type: data.type ?? 'public',
      createdById: data.createdById,
      projectId: data.projectId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.channels.push(channel)
    return channel
  }
  async update(id: string, data: Partial<NewChannel>) {
    const channel = this.channels.find((c) => c.id === id)
    if (!channel) throw new Error('Not found')
    Object.assign(channel, data, { updatedAt: new Date() })
    return channel
  }
  async delete(id: string) {
    this.channels = this.channels.filter((c) => c.id !== id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryChannelRepository', () => {
  let repo: IChannelRepository

  beforeEach(() => {
    repo = new InMemoryChannelRepository()
  })

  it('create stores a channel and returns it with an id', async () => {
    const channel = await repo.create({
      workspaceId: 'ws1',
      name: 'general',
      createdById: 'u1',
    })

    expect(channel.id).toBeDefined()
    expect(channel.name).toBe('general')
  })

  it('findById returns the correct channel', async () => {
    const created = await repo.create({
      workspaceId: 'ws1',
      name: 'dev',
      createdById: 'u1',
    })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.name).toBe('dev')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findPaginated filters by workspace', async () => {
    await repo.create({ workspaceId: 'ws1', name: 'general', createdById: 'u1' })
    await repo.create({ workspaceId: 'ws2', name: 'other', createdById: 'u1' })
    await repo.create({ workspaceId: 'ws1', name: 'dev', createdById: 'u1' })

    const result = await repo.findPaginated({} as any, 'ws1')
    expect(result.data).toHaveLength(2)
  })

  it('update modifies channel fields', async () => {
    const channel = await repo.create({ workspaceId: 'ws1', name: 'Old', createdById: 'u1' })
    const updated = await repo.update(channel.id, { name: 'New' })

    expect(updated.name).toBe('New')
  })

  it('delete removes the channel', async () => {
    const channel = await repo.create({ workspaceId: 'ws1', name: 'Temp', createdById: 'u1' })
    await repo.delete(channel.id)

    const found = await repo.findById(channel.id)
    expect(found).toBeNull()
  })
})
