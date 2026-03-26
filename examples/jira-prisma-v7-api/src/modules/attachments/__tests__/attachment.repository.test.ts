import { describe, it, expect, beforeEach } from 'vitest'
import type {
  IAttachmentRepository,
  NewAttachment,
} from '../domain/repositories/attachment.repository'

// ── In-memory implementation ─────────────────────────────────────────

type Attachment = {
  id: string
  taskId: string
  uploaderId: string
  fileName: string
  fileSize: number
  mimeType: string
  data: string
  createdAt: Date
}

class InMemoryAttachmentRepository implements IAttachmentRepository {
  private attachments: Attachment[] = []

  async findById(id: string) {
    return this.attachments.find((a) => a.id === id) ?? null
  }

  async findByTask(taskId: string) {
    return this.attachments.filter((a) => a.taskId === taskId)
  }

  async findPaginated() {
    return { data: this.attachments, total: this.attachments.length }
  }

  async create(dto: NewAttachment): Promise<Attachment> {
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

  it('create stores an attachment and returns it', async () => {
    const att = await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'report.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      data: 'base64data',
    })
    expect(att.id).toBeDefined()
    expect(att.fileName).toBe('report.pdf')
    expect(att.fileSize).toBe(1024)
  })

  it('findById returns the correct attachment', async () => {
    const created = await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'image.png',
      fileSize: 2048,
      mimeType: 'image/png',
      data: 'imgdata',
    })
    const found = await repo.findById(created.id)
    expect(found).not.toBeNull()
    expect(found!.fileName).toBe('image.png')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByTask returns only attachments for the given task', async () => {
    await repo.create({ taskId: 't1', uploaderId: 'u1', fileName: 'a.txt', fileSize: 10, mimeType: 'text/plain', data: 'd' })
    await repo.create({ taskId: 't2', uploaderId: 'u1', fileName: 'b.txt', fileSize: 20, mimeType: 'text/plain', data: 'd' })
    await repo.create({ taskId: 't1', uploaderId: 'u2', fileName: 'c.txt', fileSize: 30, mimeType: 'text/plain', data: 'd' })

    const results = await repo.findByTask('t1')
    expect(results).toHaveLength(2)
  })

  it('delete removes the attachment', async () => {
    const att = await repo.create({
      taskId: 't1',
      uploaderId: 'u1',
      fileName: 'del.txt',
      fileSize: 5,
      mimeType: 'text/plain',
      data: 'd',
    })
    await repo.delete(att.id)
    const found = await repo.findById(att.id)
    expect(found).toBeNull()
  })

  it('findPaginated returns all attachments', async () => {
    await repo.create({ taskId: 't1', uploaderId: 'u1', fileName: 'x.txt', fileSize: 1, mimeType: 'text/plain', data: 'd' })
    await repo.create({ taskId: 't1', uploaderId: 'u1', fileName: 'y.txt', fileSize: 2, mimeType: 'text/plain', data: 'd' })

    const result = await repo.findPaginated({} as any)
    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(2)
  })
})
