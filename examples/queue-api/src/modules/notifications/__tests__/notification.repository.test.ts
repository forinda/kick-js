import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryNotificationRepository } from '../infrastructure/repositories/in-memory-notification.repository'

describe('InMemoryNotificationRepository', () => {
  let repo: InMemoryNotificationRepository

  beforeEach(() => {
    repo = new InMemoryNotificationRepository()
  })

  it('should create and retrieve a notification', async () => {
    const created = await repo.create({ name: 'Test Notification' })
    expect(created).toBeDefined()
    expect(created.name).toBe('Test Notification')
    expect(created.id).toBeDefined()

    const found = await repo.findById(created.id)
    expect(found).toEqual(created)
  })

  it('should return null for non-existent id', async () => {
    const found = await repo.findById('non-existent')
    expect(found).toBeNull()
  })

  it('should list all notifications', async () => {
    await repo.create({ name: 'Notification 1' })
    await repo.create({ name: 'Notification 2' })

    const all = await repo.findAll()
    expect(all).toHaveLength(2)
  })

  it('should return paginated results', async () => {
    await repo.create({ name: 'Notification 1' })
    await repo.create({ name: 'Notification 2' })
    await repo.create({ name: 'Notification 3' })

    const result = await repo.findPaginated({
      filters: [],
      sort: [],
      search: '',
      pagination: { page: 1, limit: 2, offset: 0 },
    })

    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(3)
  })

  it('should update a notification', async () => {
    const created = await repo.create({ name: 'Original' })
    const updated = await repo.update(created.id, { name: 'Updated' })
    expect(updated.name).toBe('Updated')
  })

  it('should delete a notification', async () => {
    const created = await repo.create({ name: 'To Delete' })
    await repo.delete(created.id)
    const found = await repo.findById(created.id)
    expect(found).toBeNull()
  })
})
