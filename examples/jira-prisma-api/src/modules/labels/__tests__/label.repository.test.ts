import { describe, it, expect, beforeEach } from 'vitest'
import type { ILabelRepository, NewLabel } from '../domain/repositories/label.repository'

// ── In-memory implementation ─────────────────────────────────────────

class InMemoryLabelRepository implements ILabelRepository {
  private labels: any[] = []

  async findById(id: string) {
    return this.labels.find((l) => l.id === id) ?? null
  }
  async findByWorkspace(workspaceId: string) {
    return this.labels.filter((l) => l.workspaceId === workspaceId)
  }
  async findPaginated() {
    return { data: this.labels, total: this.labels.length }
  }
  async create(data: NewLabel) {
    const label = {
      id: `l${this.labels.length + 1}`,
      workspaceId: data.workspaceId,
      name: data.name,
      color: data.color,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.labels.push(label)
    return label
  }
  async update(id: string, data: Partial<NewLabel>) {
    const label = this.labels.find((l) => l.id === id)
    if (!label) throw new Error('Not found')
    Object.assign(label, data, { updatedAt: new Date() })
    return label
  }
  async delete(id: string) {
    this.labels = this.labels.filter((l) => l.id !== id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryLabelRepository', () => {
  let repo: ILabelRepository

  beforeEach(() => {
    repo = new InMemoryLabelRepository()
  })

  it('create stores a label and returns it with an id', async () => {
    const label = await repo.create({ workspaceId: 'ws1', name: 'Bug', color: '#ff0000' })

    expect(label.id).toBeDefined()
    expect(label.name).toBe('Bug')
    expect(label.color).toBe('#ff0000')
  })

  it('findById returns the correct label', async () => {
    const created = await repo.create({ workspaceId: 'ws1', name: 'Feature', color: '#00ff00' })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.name).toBe('Feature')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByWorkspace filters by workspace', async () => {
    await repo.create({ workspaceId: 'ws1', name: 'Bug', color: '#ff0000' })
    await repo.create({ workspaceId: 'ws2', name: 'Epic', color: '#0000ff' })
    await repo.create({ workspaceId: 'ws1', name: 'Feature', color: '#00ff00' })

    const results = await repo.findByWorkspace('ws1')
    expect(results).toHaveLength(2)
  })

  it('update modifies label fields', async () => {
    const label = await repo.create({ workspaceId: 'ws1', name: 'Old', color: '#000' })
    const updated = await repo.update(label.id, { name: 'New', color: '#fff' })

    expect(updated.name).toBe('New')
    expect(updated.color).toBe('#fff')
  })

  it('delete removes the label', async () => {
    const label = await repo.create({ workspaceId: 'ws1', name: 'Temp', color: '#000' })
    await repo.delete(label.id)

    const found = await repo.findById(label.id)
    expect(found).toBeNull()
  })
})
