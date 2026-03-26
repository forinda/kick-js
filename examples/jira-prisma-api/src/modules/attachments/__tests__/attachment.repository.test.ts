import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IAttachmentRepository,
  NewAttachment,
} from '../domain/repositories/attachment.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryAttachmentRepository implements IAttachmentRepository {
  private attachments: any[] = []

  async findById(id: string) {
    return this.attachments.find((a) => a.id === id) ?? null
  }
  async findByTask(taskId: string) {
    return this.attachments.filter((a) => a.taskId === taskId)
  }
  async findPaginated() {
    return { data: this.attachments, total: this.attachments.length }
  }
  async create(data: NewAttachment) {
    const attachment = {
      id: `a${this.attachments.length + 1}`,
      taskId: data.taskId,
      uploaderId: data.uploaderId,
      fileName: data.fileName,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      data: data.data,
      createdAt: new Date(),
      updatedAt: new Date(),
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
      fileName: 'screenshot.png',
      fileSize: 1024,
      mimeType: 'image/png',
      data: 'base64data',
    })

    expect(attachment.id).toBeDefined()
    expect(attachment.fileName).toBe('screenshot.png')
    expect(attachment.fileSize).toBe(1024)
  })

  it('findById returns the correct attachment', async () => {
    const created = await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'doc.pdf',
      fileSize: 2048,
      mimeType: 'application/pdf',
      data: 'pdfdata',
    })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.fileName).toBe('doc.pdf')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByTask filters by task', async () => {
    await repo.create({ taskId: 't1', uploaderId: 'u1', fileName: 'a.png', fileSize: 100, mimeType: 'image/png', data: 'd' })
    await repo.create({ taskId: 't2', uploaderId: 'u1', fileName: 'b.png', fileSize: 200, mimeType: 'image/png', data: 'd' })
    await repo.create({ taskId: 't1', uploaderId: 'u2', fileName: 'c.png', fileSize: 300, mimeType: 'image/png', data: 'd' })

    const results = await repo.findByTask('t1')
    expect(results).toHaveLength(2)
  })

  it('delete removes the attachment', async () => {
    const attachment = await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'temp.txt',
      fileSize: 50,
      mimeType: 'text/plain',
      data: 'hello',
    })
    await repo.delete(attachment.id)

    const found = await repo.findById(attachment.id)
    expect(found).toBeNull()
  })

  it('findPaginated returns all attachments', async () => {
    await repo.create({ taskId: 't1', uploaderId: 'u1', fileName: 'a.png', fileSize: 100, mimeType: 'image/png', data: 'd' })
    await repo.create({ taskId: 't1', uploaderId: 'u1', fileName: 'b.png', fileSize: 200, mimeType: 'image/png', data: 'd' })

    const result = await repo.findPaginated({} as any)
    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(2)
  })
})
