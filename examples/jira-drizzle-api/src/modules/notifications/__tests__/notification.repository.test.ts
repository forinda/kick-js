import { describe, it, expect, beforeEach } from 'vitest'
import type {
  INotificationRepository,
  Notification,
  NewNotification,
} from '../domain/repositories/notification.repository'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryNotificationRepository implements INotificationRepository {
  private notifications: Notification[] = []

  async findById(id: string) {
    return this.notifications.find((n) => n.id === id) ?? null
  }

  async findPaginated(
    parsed: { pagination?: { page?: number; limit?: number } },
    recipientId: string,
  ) {
    const filtered = this.notifications.filter((n) => n.recipientId === recipientId)
    const page = parsed.pagination?.page ?? 1
    const limit = parsed.pagination?.limit ?? 20
    const start = (page - 1) * limit
    return { data: filtered.slice(start, start + limit), total: filtered.length }
  }

  async create(dto: NewNotification) {
    const notification: Notification = {
      id: `n${this.notifications.length + 1}`,
      recipientId: dto.recipientId,
      type: dto.type,
      title: dto.title,
      body: dto.body,
      metadata: dto.metadata ?? {},
      isRead: dto.isRead ?? false,
      createdAt: new Date(),
    }
    this.notifications.push(notification)
    return notification
  }

  async markRead(id: string) {
    const n = this.notifications.find((n) => n.id === id)
    if (n) n.isRead = true
  }

  async markAllRead(recipientId: string) {
    this.notifications
      .filter((n) => n.recipientId === recipientId)
      .forEach((n) => (n.isRead = true))
  }

  async unreadCount(recipientId: string) {
    return this.notifications.filter((n) => n.recipientId === recipientId && !n.isRead).length
  }

  async delete(id: string) {
    this.notifications = this.notifications.filter((n) => n.id !== id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryNotificationRepository', () => {
  let repo: INotificationRepository

  beforeEach(() => {
    repo = new InMemoryNotificationRepository()
  })

  it('create stores a notification and returns it with an id', async () => {
    const notification = await repo.create({
      recipientId: 'u1',
      type: 'task_assigned',
      title: 'Task assigned',
      body: 'You have been assigned a task',
    })

    expect(notification.id).toBeDefined()
    expect(notification.type).toBe('task_assigned')
    expect(notification.isRead).toBe(false)
  })

  it('create sets default values for optional fields', async () => {
    const notification = await repo.create({
      recipientId: 'u1',
      type: 'mentioned',
      title: 'Mentioned',
      body: 'You were mentioned',
    })

    expect(notification.metadata).toEqual({})
    expect(notification.isRead).toBe(false)
  })

  it('findById returns the correct notification', async () => {
    const created = await repo.create({
      recipientId: 'u1',
      type: 'comment_added',
      title: 'New comment',
      body: 'Someone commented',
    })
    const found = await repo.findById(created.id)

    expect(found).not.toBeNull()
    expect(found!.title).toBe('New comment')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findPaginated filters by recipientId', async () => {
    await repo.create({
      recipientId: 'u1',
      type: 'task_assigned',
      title: 'T1',
      body: 'B1',
    })
    await repo.create({
      recipientId: 'u2',
      type: 'mentioned',
      title: 'T2',
      body: 'B2',
    })

    const result = await repo.findPaginated({}, 'u1')
    expect(result.data).toHaveLength(1)
    expect(result.total).toBe(1)
  })

  it('markRead sets isRead to true', async () => {
    const n = await repo.create({
      recipientId: 'u1',
      type: 'task_overdue',
      title: 'Overdue',
      body: 'Task is overdue',
    })

    await repo.markRead(n.id)
    const found = await repo.findById(n.id)
    expect(found!.isRead).toBe(true)
  })

  it('markAllRead marks all notifications for a recipient', async () => {
    await repo.create({
      recipientId: 'u1',
      type: 'task_assigned',
      title: 'T1',
      body: 'B1',
    })
    await repo.create({
      recipientId: 'u1',
      type: 'mentioned',
      title: 'T2',
      body: 'B2',
    })
    await repo.create({
      recipientId: 'u2',
      type: 'comment_added',
      title: 'T3',
      body: 'B3',
    })

    await repo.markAllRead('u1')
    const count = await repo.unreadCount('u1')
    expect(count).toBe(0)

    // u2's notification should still be unread
    const u2Count = await repo.unreadCount('u2')
    expect(u2Count).toBe(1)
  })

  it('unreadCount returns correct count', async () => {
    await repo.create({
      recipientId: 'u1',
      type: 'task_assigned',
      title: 'T1',
      body: 'B1',
    })
    await repo.create({
      recipientId: 'u1',
      type: 'mentioned',
      title: 'T2',
      body: 'B2',
    })

    expect(await repo.unreadCount('u1')).toBe(2)

    const all = await repo.findPaginated({}, 'u1')
    await repo.markRead(all.data[0].id)

    expect(await repo.unreadCount('u1')).toBe(1)
  })

  it('delete removes the notification', async () => {
    const n = await repo.create({
      recipientId: 'u1',
      type: 'workspace_invite',
      title: 'Invite',
      body: 'You are invited',
    })
    await repo.delete(n.id)

    const found = await repo.findById(n.id)
    expect(found).toBeNull()
  })
})
