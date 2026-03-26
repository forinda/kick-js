import { describe, it, expect, beforeEach } from 'vitest'
import type {
  INotificationRepository,
  NewNotification,
} from '../domain/repositories/notification.repository'

// ── In-memory implementation ─────────────────────────────────────────

type Notification = {
  id: string
  recipientId: string
  type: string
  title: string
  body: string
  metadata: any
  isRead: boolean
  createdAt: Date
}

class InMemoryNotificationRepository implements INotificationRepository {
  private notifications: Notification[] = []

  async findById(id: string) {
    return this.notifications.find((n) => n.id === id) ?? null
  }

  async findPaginated(_parsed: any, recipientId: string) {
    const filtered = this.notifications.filter((n) => n.recipientId === recipientId)
    return { data: filtered, total: filtered.length }
  }

  async create(dto: NewNotification): Promise<Notification> {
    const notification: Notification = {
      id: `n${this.notifications.length + 1}`,
      recipientId: dto.recipientId,
      type: dto.type,
      title: dto.title,
      body: dto.body,
      metadata: dto.metadata ?? {},
      isRead: false,
      createdAt: new Date(),
    }
    this.notifications.push(notification)
    return notification
  }

  async markRead(id: string) {
    const notif = this.notifications.find((n) => n.id === id)
    if (notif) notif.isRead = true
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

  it('create stores a notification and returns it', async () => {
    const notif = await repo.create({
      recipientId: 'u1',
      type: 'task_assigned',
      title: 'Task assigned',
      body: 'You have been assigned a task',
    })
    expect(notif.id).toBeDefined()
    expect(notif.title).toBe('Task assigned')
    expect(notif.isRead).toBe(false)
  })

  it('findById returns the correct notification', async () => {
    const created = await repo.create({
      recipientId: 'u1',
      type: 'mentioned',
      title: 'Mentioned',
      body: 'You were mentioned',
    })
    const found = await repo.findById(created.id)
    expect(found).not.toBeNull()
    expect(found!.title).toBe('Mentioned')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findPaginated filters by recipient', async () => {
    await repo.create({ recipientId: 'u1', type: 'task_assigned', title: 'N1', body: 'B1' })
    await repo.create({ recipientId: 'u2', type: 'mentioned', title: 'N2', body: 'B2' })
    await repo.create({ recipientId: 'u1', type: 'comment_added', title: 'N3', body: 'B3' })

    const result = await repo.findPaginated({} as any, 'u1')
    expect(result.data).toHaveLength(2)
  })

  it('markRead marks a notification as read', async () => {
    const notif = await repo.create({
      recipientId: 'u1',
      type: 'task_assigned',
      title: 'N',
      body: 'B',
    })
    await repo.markRead(notif.id)
    const found = await repo.findById(notif.id)
    expect(found!.isRead).toBe(true)
  })

  it('markAllRead marks all notifications for a recipient as read', async () => {
    await repo.create({ recipientId: 'u1', type: 'task_assigned', title: 'N1', body: 'B1' })
    await repo.create({ recipientId: 'u1', type: 'mentioned', title: 'N2', body: 'B2' })
    await repo.create({ recipientId: 'u2', type: 'mentioned', title: 'N3', body: 'B3' })

    await repo.markAllRead('u1')
    const count = await repo.unreadCount('u1')
    expect(count).toBe(0)

    const u2Count = await repo.unreadCount('u2')
    expect(u2Count).toBe(1)
  })

  it('unreadCount returns correct count', async () => {
    await repo.create({ recipientId: 'u1', type: 'task_assigned', title: 'N1', body: 'B1' })
    await repo.create({ recipientId: 'u1', type: 'mentioned', title: 'N2', body: 'B2' })

    expect(await repo.unreadCount('u1')).toBe(2)

    const notifs = (await repo.findPaginated({} as any, 'u1')).data
    await repo.markRead(notifs[0].id)
    expect(await repo.unreadCount('u1')).toBe(1)
  })

  it('delete removes the notification', async () => {
    const notif = await repo.create({
      recipientId: 'u1',
      type: 'task_assigned',
      title: 'Del',
      body: 'B',
    })
    await repo.delete(notif.id)
    const found = await repo.findById(notif.id)
    expect(found).toBeNull()
  })
})
