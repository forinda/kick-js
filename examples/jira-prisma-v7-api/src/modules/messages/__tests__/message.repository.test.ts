import { describe, it, expect, beforeEach } from 'vitest'
import type { IMessageRepository, NewMessage } from '../domain/repositories/message.repository'

// ── In-memory implementation ─────────────────────────────────────────

type Message = {
  id: string
  channelId: string
  senderId: string
  content: string
  mentions: any
  isEdited: boolean
  createdAt: Date
  updatedAt: Date
}

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

  async findPaginated(_parsed: any, channelId: string) {
    const filtered = this.messages.filter((m) => m.channelId === channelId)
    return { data: filtered, total: filtered.length }
  }

  async create(dto: NewMessage): Promise<Message> {
    const message: Message = {
      id: `m${this.messages.length + 1}`,
      channelId: dto.channelId,
      senderId: dto.senderId,
      content: dto.content,
      mentions: dto.mentions ?? [],
      isEdited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.messages.push(message)
    return message
  }

  async update(id: string, dto: Partial<NewMessage>): Promise<Message> {
    const message = this.messages.find((m) => m.id === id)
    if (!message) throw new Error('Not found')
    Object.assign(message, dto, { isEdited: true, updatedAt: new Date() })
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

  it('create stores a message and returns it', async () => {
    const msg = await repo.create({
      channelId: 'ch1',
      senderId: 'u1',
      content: 'Hello world',
    })
    expect(msg.id).toBeDefined()
    expect(msg.content).toBe('Hello world')
    expect(msg.isEdited).toBe(false)
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

  it('findByChannel returns messages for the given channel', async () => {
    await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'M1' })
    await repo.create({ channelId: 'ch2', senderId: 'u1', content: 'M2' })
    await repo.create({ channelId: 'ch1', senderId: 'u2', content: 'M3' })

    const results = await repo.findByChannel('ch1')
    expect(results).toHaveLength(2)
  })

  it('findByChannel supports limit', async () => {
    await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'M1' })
    await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'M2' })
    await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'M3' })

    const results = await repo.findByChannel('ch1', undefined, 2)
    expect(results).toHaveLength(2)
  })

  it('update modifies message content and marks as edited', async () => {
    const msg = await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'Old' })
    const updated = await repo.update(msg.id, { content: 'New' })
    expect(updated.content).toBe('New')
    expect(updated.isEdited).toBe(true)
  })

  it('delete removes the message', async () => {
    const msg = await repo.create({ channelId: 'ch1', senderId: 'u1', content: 'Delete me' })
    await repo.delete(msg.id)
    const found = await repo.findById(msg.id)
    expect(found).toBeNull()
  })
})
