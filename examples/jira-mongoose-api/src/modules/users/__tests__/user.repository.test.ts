import { describe, it, expect, beforeEach } from 'vitest'
import type { Types } from 'mongoose'
import type { IUserRepository } from '../domain/repositories/user.repository'
import type { UserEntity } from '../domain/entities/user.entity'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryUserRepository implements IUserRepository {
  private users: UserEntity[] = []
  private counter = 0

  private fakeId(): Types.ObjectId {
    this.counter++
    return `u${this.counter}` as unknown as Types.ObjectId
  }

  async findById(id: string) {
    return this.users.find((u) => String(u._id) === id) ?? null
  }

  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null
  }

  async create(data: Partial<UserEntity>) {
    const user: UserEntity = {
      _id: this.fakeId(),
      email: data.email!,
      passwordHash: data.passwordHash ?? 'hash',
      firstName: data.firstName ?? 'Test',
      lastName: data.lastName ?? 'User',
      globalRole: data.globalRole ?? 'user',
      isActive: data.isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.users.push(user)
    return user
  }

  async update(id: string, data: Partial<UserEntity>) {
    const user = this.users.find((u) => String(u._id) === id)
    if (!user) return null
    Object.assign(user, data, { updatedAt: new Date() })
    return user
  }

  async findPaginated() {
    return { data: this.users, total: this.users.length }
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryUserRepository', () => {
  let repo: IUserRepository

  beforeEach(() => {
    repo = new InMemoryUserRepository()
  })

  it('create stores a user and returns it with an _id', async () => {
    const user = await repo.create({
      email: 'alice@test.com',
      passwordHash: 'hash123',
      firstName: 'Alice',
      lastName: 'Smith',
    })

    expect(user._id).toBeDefined()
    expect(user.email).toBe('alice@test.com')
    expect(user.firstName).toBe('Alice')
  })

  it('findById returns the correct user', async () => {
    const created = await repo.create({
      email: 'bob@test.com',
      passwordHash: 'h',
      firstName: 'Bob',
      lastName: 'Test',
    })
    const found = await repo.findById(String(created._id))

    expect(found).not.toBeNull()
    expect(found!.email).toBe('bob@test.com')
  })

  it('findById returns null for unknown id', async () => {
    const found = await repo.findById('nonexistent')
    expect(found).toBeNull()
  })

  it('findByEmail returns the correct user', async () => {
    await repo.create({
      email: 'carol@test.com',
      passwordHash: 'h',
      firstName: 'Carol',
      lastName: 'Test',
    })
    const found = await repo.findByEmail('carol@test.com')

    expect(found).not.toBeNull()
    expect(found!.email).toBe('carol@test.com')
  })

  it('findPaginated returns all users', async () => {
    await repo.create({ email: 'a@test.com', passwordHash: 'h', firstName: 'A', lastName: 'Test' })
    await repo.create({ email: 'b@test.com', passwordHash: 'h', firstName: 'B', lastName: 'Test' })

    const result = await repo.findPaginated({})
    expect(result.data).toHaveLength(2)
    expect(result.total).toBe(2)
  })

  it('update modifies user fields', async () => {
    const user = await repo.create({
      email: 'dave@test.com',
      passwordHash: 'h',
      firstName: 'Dave',
      lastName: 'Test',
    })
    const updated = await repo.update(String(user._id), { firstName: 'David' })

    expect(updated).not.toBeNull()
    expect(updated!.firstName).toBe('David')
    expect(updated!.email).toBe('dave@test.com')
  })

  it('update returns null for unknown id', async () => {
    const updated = await repo.update('nonexistent', { firstName: 'Ghost' })
    expect(updated).toBeNull()
  })
})
