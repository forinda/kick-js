import { describe, it, expect, beforeEach } from 'vitest'
import type {
  ICommentRepository,
  Comment,
  NewComment,
} from '../domain/repositories/comment.repository'

// ── In-memory implementation for testing ─────────────────────────────

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

  async create(data: NewComment) {
    const comment: Comment = {
      id: `c${this.comments.length + 1}`,
      taskId: data.taskId,
      authorId: data.authorId,
      content: data.content,
      mentions: data.mentions ?? [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.comments.push(comment)
    return comment
  }

  async update(id: string, data: Partial<NewComment>) {
    const comment = this.comments.find((c) => c.id === id)
    if (!comment) throw new Error('Not found')
    Object.assign(comment, data, { updatedAt: new Date() })
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

  it('create stores a comment and returns it with an id', async () => {
    const comment = await repo.create({
      taskId: 't1',
      authorId: 'u1',
      content: 'Looks good!',
    })

    expect(comment.id).toBeDefined()
    expect(comment.content).toBe('Looks good!')
    expect(comment.mentions).toEqual([])
  })

  it('findById returns the correct comment', async () => {
    const created = await repo.create({ taskId: 't1', authorId: 'u1', content: 'Find me' })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.content).toBe('Find me')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByTask returns comments for a given task', async () => {
    await repo.create({ taskId: 't1', authorId: 'u1', content: 'C1' })
    await repo.create({ taskId: 't2', authorId: 'u1', content: 'C2' })
    await repo.create({ taskId: 't1', authorId: 'u2', content: 'C3' })

    const results = await repo.findByTask('t1')
    expect(results).toHaveLength(2)
  })

  it('countByTask returns correct count', async () => {
    await repo.create({ taskId: 't1', authorId: 'u1', content: 'C1' })
    await repo.create({ taskId: 't1', authorId: 'u2', content: 'C2' })
    await repo.create({ taskId: 't2', authorId: 'u1', content: 'C3' })

    const count = await repo.countByTask('t1')
    expect(count).toBe(2)
  })

  it('update modifies comment fields', async () => {
    const comment = await repo.create({ taskId: 't1', authorId: 'u1', content: 'Old' })
    const updated = await repo.update(comment.id, { content: 'New' })

    expect(updated.content).toBe('New')
    expect(updated.taskId).toBe('t1')
  })

  it('delete removes the comment', async () => {
    const comment = await repo.create({ taskId: 't1', authorId: 'u1', content: 'Temp' })
    await repo.delete(comment.id)

    const found = await repo.findById(comment.id)
    expect(found).toBeNull()
  })
})
