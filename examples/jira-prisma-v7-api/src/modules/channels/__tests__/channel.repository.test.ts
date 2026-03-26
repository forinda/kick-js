import { describe, it, expect, beforeEach } from 'vitest'
import type { IChannelRepository, NewChannel } from '../domain/repositories/channel.repository'

// ── In-memory implementation ─────────────────────────────────────────

type Channel = {
  id: string
  workspaceId: string
  projectId: string | null
  name: string
  description: string | null
  type: string
  createdById: string
  createdAt: Date
  updatedAt: Date
}

class InMemoryChannelRepository implements IChannelRepository {
  private channels: Channel[] = []

  async findById(id: string) {
    return this.channels.find((c) => c.id === id) ?? null
  }

  async findPaginated(_parsed: any, workspaceId: string) {
    const filtered = this.channels.filter((c) => c.workspaceId === workspaceId)
    return { data: filtered, total: filtered.length }
  }

  async create(dto: NewChannel): Promise<Channel> {
    const channel: Channel = {
      id: `ch${this.channels.length + 1}`,
      workspaceId: dto.workspaceId,
      name: dto.name,
      description: dto.description ?? null,
      type: dto.type ?? 'public',
      createdById: dto.createdById,
      projectId: dto.projectId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.channels.push(channel)
    return channel
  }

  async update(id: string, data: Partial<NewChannel>): Promise<Channel> {
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

  it('create stores a channel and returns it', async () => {
    const channel = await repo.create({
      workspaceId: 'w1',
      name: 'general',
      createdById: 'u1',
    })
    expect(channel.id).toBeDefined()
    expect(channel.name).toBe('general')
    expect(channel.type).toBe('public')
  })

  it('findById returns the correct channel', async () => {
    const created = await repo.create({ workspaceId: 'w1', name: 'dev', createdById: 'u1' })
    const found = await repo.findById(created.id)
    expect(found).not.toBeNull()
    expect(found!.name).toBe('dev')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findPaginated filters by workspace', async () => {
    await repo.create({ workspaceId: 'w1', name: 'ch1', createdById: 'u1' })
    await repo.create({ workspaceId: 'w2', name: 'ch2', createdById: 'u1' })
    await repo.create({ workspaceId: 'w1', name: 'ch3', createdById: 'u1' })

    const result = await repo.findPaginated({} as any, 'w1')
    expect(result.data).toHaveLength(2)
  })

  it('update modifies channel fields', async () => {
    const channel = await repo.create({ workspaceId: 'w1', name: 'old', createdById: 'u1' })
    const updated = await repo.update(channel.id, { name: 'new' })
    expect(updated.name).toBe('new')
  })

  it('delete removes the channel', async () => {
    const channel = await repo.create({ workspaceId: 'w1', name: 'del', createdById: 'u1' })
    await repo.delete(channel.id)
    const found = await repo.findById(channel.id)
    expect(found).toBeNull()
  })
})
