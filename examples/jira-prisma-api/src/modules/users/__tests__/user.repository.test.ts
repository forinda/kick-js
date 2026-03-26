import { describe, it, expect, beforeEach } from 'vitest'
import type { IUserRepository } from '../domain/repositories/user.repository'

// ── In-memory implementation for testing ─────────────────────────────

class InMemoryUserRepository implements IUserRepository {
  private users: any[] = []

  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null
  }

  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null
  }

  async findAll() {
    return this.users
  }

  async findPaginated() {
    return { data: this.users, total: this.users.length }
  }

  async create(dto: any) {
    const user = {
      id: `u${this.users.length + 1}`,
      email: dto.email,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      passwordHash: dto.passwordHash,
      globalRole: dto.globalRole ?? 'user',
      isActive: true,
      avatarUrl: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.users.push(user)
    return user
  }

  async update(id: string, dto: any) {
    const user = this.users.find((u) => u.id === id)
    if (!user) throw new Error('Not found')
    Object.assign(user, dto, { updatedAt: new Date() })
    return user
  }

  async delete(id: string) {
    this.users = this.users.filter((u) => u.id !== id)
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('InMemoryUserRepository', () => {
  let repo: IUserRepository

  beforeEach(() => {
    repo = new InMemoryUserRepository()
  })

  it('create stores a user and returns it with an id', async () => {
    const user = await repo.create({
      email: 'alice@test.com',
      passwordHash: 'hash123',
      firstName: 'Alice',
      lastName: 'Smith',
    })

    expect(user.id).toBeDefined()
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
    const found = await repo.findById(created.id)

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

  it('findAll returns all users', async () => {
    await repo.create({ email: 'a@test.com', passwordHash: 'h', firstName: 'A', lastName: 'Test' })
    await repo.create({ email: 'b@test.com', passwordHash: 'h', firstName: 'B', lastName: 'Test' })

    const all = await repo.findAll()
    expect(all).toHaveLength(2)
  })

  it('update modifies user fields', async () => {
    const user = await repo.create({
      email: 'dave@test.com',
      passwordHash: 'h',
      firstName: 'Dave',
      lastName: 'Test',
    })
    const updated = await repo.update(user.id, { firstName: 'David' })

    expect(updated.firstName).toBe('David')
    expect(updated.email).toBe('dave@test.com')
  })

  it('delete removes the user', async () => {
    const user = await repo.create({
      email: 'eve@test.com',
      passwordHash: 'h',
      firstName: 'Eve',
      lastName: 'Test',
    })
    await repo.delete(user.id)

    const found = await repo.findById(user.id)
    expect(found).toBeNull()
  })
})
