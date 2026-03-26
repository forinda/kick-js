import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IMessageRepository,
  NewMessage,
} from '../domain/repositories/message.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryMessageRepository implements IMessageRepository {
  private messages: any[] = []

  async findById(id: string) {
    return this.messages.find((m) => m.id === id) ?? null
  }
  async findByChannel(channelId: string, _cursor?: string, limit?: number) {
    const filtered = this.messages.filter((m) => m.channelId === channelId)
    return limit ? filtered.slice(0, limit) : filtered
  }
  async findPaginated(_parsed: any, channelId: string) {
    const filtered = this.messages.filter((m) => m.channelId === channelId)
    return { data: filtered, total: filtered.length }
  }
  async create(data: NewMessage) {
    const message = {
      id: `m${this.messages.length + 1}`,
      channelId: data.channelId,
      senderId: data.senderId,
      content: data.content,
      mentions: data.mentions ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.messages.push(message)
    return message
  }
  async update(id: string, data: Partial<NewMessage>) {
    const message = this.messages.find((m) => m.id === id)
    if (!message) throw new Error('Not found')
    Object.assign(message, data, { updatedAt: new Date() })
    return message
  }
  async delete(id: string) {
    this.messages = this.messages.filter((m) => m.id !== id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryMessageRepository', () => {
  let repo: IMessageRepository

  beforeEach(() => {
    repo = new InMemoryMessageRepository()
  })

  it('create stores a message and returns it with an id', async () => {
    const message = await repo.create({
      channelId: 'ch1',
      senderId: 'u1',
      content: 'Hello world',
    })

    expect(message.id).toBeDefined()
    expect(message.content).toBe('Hello world')
  })

  it('findById returns the correct message', async () => {
    const created = await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'Test' })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.content).toBe('Test')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByChannel filters by channel', async () => {
    await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'A' })
    await repo.create({ channelId: 'ch2', senderId: 'u1', content: 'B' })
    await repo.create({ channelId: 'ch1', senderId: 'u2', content: 'C' })

    const results = await repo.findByChannel('ch1')
    expect(results).toHaveLength(2)
  })

  it('findByChannel respects limit', async () => {
    await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'A' })
    await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'B' })
    await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'C' })

    const results = await repo.findByChannel('ch1', undefined, 2)
    expect(results).toHaveLength(2)
  })

  it('update modifies message content', async () => {
    const message = await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'Old' })
    const updated = await repo.update(message.id, { content: 'New' })

    expect(updated.content).toBe('New')
  })

  it('delete removes the message', async () => {
    const message = await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'Temp' })
    await repo.delete(message.id)

    const found = await repo.findById(message.id)
    expect(found).toBeNull()
  })
})
