import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IAttachmentRepository,
  Attachment,
  NewAttachment,
} from '../domain/repositories/attachment.repository'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryAttachmentRepository implements IAttachmentRepository {
  private attachments: Attachment[] = []

  async findById(id: string) {
    return this.attachments.find((a) => a.id === id) ?? null
  }

  async findByTask(taskId: string) {
    return this.attachments.filter((a) => a.taskId === taskId)
  }

  async findPaginated(
    parsed: { pagination?: { page?: number; limit?: number } },
    taskId?: string,
  ) {
    let filtered = this.attachments
    if (taskId) filtered = filtered.filter((a) => a.taskId === taskId)
    const page = parsed.pagination?.page ?? 1
    const limit = parsed.pagination?.limit ?? 20
    const start = (page - 1) * limit
    return { data: filtered.slice(start, start + limit), total: filtered.length }
  }

  async create(dto: NewAttachment) {
    const attachment: Attachment = {
      id: `att${this.attachments.length + 1}`,
      taskId: dto.taskId,
      uploaderId: dto.uploaderId,
      fileName: dto.fileName,
      fileSize: dto.fileSize,
      mimeType: dto.mimeType,
      data: dto.data,
      createdAt: new Date(),
    }
    this.attachments.push(attachment)
    return attachment
  }

  async delete(id: string) {
    this.attachments = this.attachments.filter((a) => a.id !== id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryAttachmentRepository', () => {
  let repo: IAttachmentRepository

  beforeEach(() => {
    repo = new InMemoryAttachmentRepository()
  })

  it('create stores an attachment and returns it with an id', async () => {
    const attachment = await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'report.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      data: 'base64data',
    })

    expect(attachment.id).toBeDefined()
    expect(attachment.fileName).toBe('report.pdf')
    expect(attachment.fileSize).toBe(1024)
  })

  it('findById returns the correct attachment', async () => {
    const created = await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'image.png',
      fileSize: 2048,
      mimeType: 'image/png',
      data: 'base64data',
    })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.fileName).toBe('image.png')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByTask returns all attachments for a task', async () => {
    await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'a.txt',
      fileSize: 100,
      mimeType: 'text/plain',
      data: 'data1',
    })
    await repo.create({
      taskId: 't1',
      uploaderId: 'u2',
      fileName: 'b.txt',
      fileSize: 200,
      mimeType: 'text/plain',
      data: 'data2',
    })
    await repo.create({
      taskId: 't2',
      uploaderId: 'u1',
      fileName: 'c.txt',
      fileSize: 300,
      mimeType: 'text/plain',
      data: 'data3',
    })

    const result = await repo.findByTask('t1')
    expect(result).toHaveLength(2)
  })

  it('findPaginated filters by taskId', async () => {
    await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'x.txt',
      fileSize: 10,
      mimeType: 'text/plain',
      data: 'data',
    })
    await repo.create({
      taskId: 't2',
      uploaderId: 'u1',
      fileName: 'y.txt',
      fileSize: 20,
      mimeType: 'text/plain',
      data: 'data',
    })

    const result = await repo.findPaginated({}, 't1')
    expect(result.data).toHaveLength(1)
    expect(result.total).toBe(1)
  })

  it('delete removes the attachment', async () => {
    const attachment = await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'del.txt',
      fileSize: 50,
      mimeType: 'text/plain',
      data: 'data',
    })
    await repo.delete(attachment.id)

    const found = await repo.findById(attachment.id)
    expect(found).toBeNull()
  })

  it('findPaginated returns all when no taskId filter', async () => {
    await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'a.txt',
      fileSize: 10,
      mimeType: 'text/plain',
      data: 'data',
    })
    await repo.create({
      taskId: 't2',
      uploaderId: 'u1',
      fileName: 'b.txt',
      fileSize: 20,
      mimeType: 'text/plain',
      data: 'data',
    })

    const result = await repo.findPaginated({})
    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(2)
  })
})
