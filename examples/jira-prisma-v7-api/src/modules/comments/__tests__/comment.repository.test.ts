import { describe, it, expect, beforeEach } from 'vitest'
import type { ICommentRepository, NewComment } from '../domain/repositories/comment.repository'

// ── In-memory implementation ─────────────────────────────────────────

type Comment = {
  id: string
  taskId: string
  authorId: string
  content: string
  mentions: any
  createdAt: Date
  updatedAt: Date
}

class InMemoryCommentRepository implements ICommentRepository {
  private comments: Comment[] = []

  async findById(id: string) {
    return this.comments.find((c) => c.id === id) ?? null
  }

  async findByTask(taskId: string) {
    return this.comments.filter((c) => c.taskId === taskId)
  }

  async findPaginated() {
    return { data: this.comments, total: this.comments.length }
  }

  async create(dto: NewComment): Promise<Comment> {
    const comment: Comment = {
      id: `c${this.comments.length + 1}`,
      taskId: dto.taskId,
      authorId: dto.authorId,
      content: dto.content,
      mentions: dto.mentions ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.comments.push(comment)
    return comment
  }

  async update(id: string, dto: Partial<NewComment>): Promise<Comment> {
    const comment = this.comments.find((c) => c.id === id)
    if (!comment) throw new Error('Not found')
    Object.assign(comment, dto, { updatedAt: new Date() })
    return comment
  }

  async delete(id: string) {
    this.comments = this.comments.filter((c) => c.id !== id)
  }

  async countByTask(taskId: string) {
    return this.comments.filter((c) => c.taskId === taskId).length
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryCommentRepository', () => {
  let repo: ICommentRepository

  beforeEach(() => {
    repo = new InMemoryCommentRepository()
  })

  it('create stores a comment and returns it', async () => {
    const comment = await repo.create({
      taskId: 't1',
      authorId: 'u1',
      content: 'Looks good!',
    })
    expect(comment.id).toBeDefined()
    expect(comment.content).toBe('Looks good!')
    expect(comment.taskId).toBe('t1')
  })

  it('findById returns the correct comment', async () => {
    const created = await repo.create({ taskId: 't1', authorId: 'u1', content: 'Test' })
    const found = await repo.findById(created.id)
    expect(found).not.toBeNull()
    expect(found!.content).toBe('Test')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByTask returns only comments for the given task', async () => {
    await repo.create({ taskId: 't1', authorId: 'u1', content: 'C1' })
    await repo.create({ taskId: 't2', authorId: 'u1', content: 'C2' })
    await repo.create({ taskId: 't1', authorId: 'u2', content: 'C3' })

    const results = await repo.findByTask('t1')
    expect(results).toHaveLength(2)
  })

  it('update modifies comment content', async () => {
    const comment = await repo.create({ taskId: 't1', authorId: 'u1', content: 'Old' })
    const updated = await repo.update(comment.id, { content: 'Updated' })
    expect(updated.content).toBe('Updated')
  })

  it('delete removes the comment', async () => {
    const comment = await repo.create({ taskId: 't1', authorId: 'u1', content: 'Delete me' })
    await repo.delete(comment.id)
    const found = await repo.findById(comment.id)
    expect(found).toBeNull()
  })

  it('countByTask returns correct count', async () => {
    await repo.create({ taskId: 't1', authorId: 'u1', content: 'C1' })
    await repo.create({ taskId: 't1', authorId: 'u2', content: 'C2' })
    await repo.create({ taskId: 't2', authorId: 'u1', content: 'C3' })

    const count = await repo.countByTask('t1')
    expect(count).toBe(2)
  })
})
