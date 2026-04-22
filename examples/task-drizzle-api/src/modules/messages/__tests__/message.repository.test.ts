import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IMessageRepository,
  Message,
  NewMessage,
} from '../domain/repositories/message.repository'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryMessageRepository implements IMessageRepository {
  private messages: Message[] = []

  async findById(id: string) {
    return this.messages.find((m) => m.id === id) ?? null
  }

  async findByChannel(channelId: string, cursor?: string, limit?: number) {
    let filtered = this.messages.filter((m) => m.channelId === channelId)
    if (cursor) {
      const idx = filtered.findIndex((m) => m.id === cursor)
      if (idx >= 0) filtered = filtered.slice(idx + 1)
    }
    if (limit) filtered = filtered.slice(0, limit)
    return filtered
  }

  async findPaginated(
    parsed: { pagination?: { page?: number; limit?: number } },
    channelId: string,
  ) {
    const filtered = this.messages.filter((m) => m.channelId === channelId)
    const page = parsed.pagination?.page ?? 1
    const limit = parsed.pagination?.limit ?? 20
    const start = (page - 1) * limit
    return { data: filtered.slice(start, start + limit), total: filtered.length }
  }

  async create(dto: NewMessage) {
    const message: Message = {
      id: `m${this.messages.length + 1}`,
      channelId: dto.channelId,
      senderId: dto.senderId,
      content: dto.content,
      mentions: dto.mentions ?? [],
      isEdited: dto.isEdited ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.messages.push(message)
    return message
  }

  async update(id: string, dto: Partial<NewMessage>) {
    const message = this.messages.find((m) => m.id === id)
    if (!message) throw new Error('Not found')
    Object.assign(message, dto, { updatedAt: new Date() })
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
    expect(message.channelId).toBe('ch1')
  })

  it('create sets default values for optional fields', async () => {
    const message = await repo.create({
      channelId: 'ch1',
      senderId: 'u1',
      content: 'Test',
    })

    expect(message.mentions).toEqual([])
    expect(message.isEdited).toBe(false)
  })

  it('findById returns the correct message', async () => {
    const created = await repo.create({
      channelId: 'ch1',
      senderId: 'u1',
      content: 'Find me',
    })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.content).toBe('Find me')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByChannel returns messages for a specific channel', async () => {
    await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'msg1' })
    await repo.create({ channelId: 'ch2', senderId: 'u1', content: 'msg2' })
    await repo.create({ channelId: 'ch1', senderId: 'u2', content: 'msg3' })

    const result = await repo.findByChannel('ch1')
    expect(result).toHaveLength(2)
  })

  it('update modifies message fields', async () => {
    const message = await repo.create({
      channelId: 'ch1',
      senderId: 'u1',
      content: 'Original',
    })
    const updated = await repo.update(message.id, { content: 'Edited' })

    expect(updated.content).toBe('Edited')
    expect(updated.channelId).toBe('ch1')
  })

  it('delete removes the message', async () => {
    const message = await repo.create({
      channelId: 'ch1',
      senderId: 'u1',
      content: 'Delete me',
    })
    await repo.delete(message.id)

    const found = await repo.findById(message.id)
    expect(found).toBeNull()
  })
})
