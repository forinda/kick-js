import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryTaskRepository } from '../infrastructure/repositories/in-memory-task.repository'

describe('InMemoryTaskRepository', () => {
  let repo: InMemoryTaskRepository

  beforeEach(() => {
    repo = new InMemoryTaskRepository()
  })

  it('should create and retrieve a task', async () => {
    const created = await repo.create({ name: 'Test Task' })
    expect(created).toBeDefined()
    expect(created.name).toBe('Test Task')
    expect(created.id).toBeDefined()

    const found = await repo.findById(created.id)
    expect(found).toEqual(created)
  })

  it('should return null for non-existent id', async () => {
    const found = await repo.findById('non-existent')
    expect(found).toBeNull()
  })

  it('should list all tasks', async () => {
    await repo.create({ name: 'Task 1' })
    await repo.create({ name: 'Task 2' })

    const all = await repo.findAll()
    expect(all).toHaveLength(2)
  })

  it('should return paginated results', async () => {
    await repo.create({ name: 'Task 1' })
    await repo.create({ name: 'Task 2' })
    await repo.create({ name: 'Task 3' })

    const result = await repo.findPaginated({
      filters: [],
      sort: [],
      search: '',
      pagination: { page: 1, limit: 2, offset: 0 },
    })

    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(3)
  })

  it('should update a task', async () => {
    const created = await repo.create({ name: 'Original' })
    const updated = await repo.update(created.id, { name: 'Updated' })
    expect(updated.name).toBe('Updated')
  })

  it('should delete a task', async () => {
    const created = await repo.create({ name: 'To Delete' })
    await repo.delete(created.id)
    const found = await repo.findById(created.id)
    expect(found).toBeNull()
  })
})
