import { randomUUID } from 'node:crypto'

export class UsersId {
  private constructor(private readonly value: string) {}

  static create(): UsersId {
    return new UsersId(randomUUID())
  }

  static from(id: string): UsersId {
    if (!id || id.trim().length === 0) {
      throw new Error('UsersId cannot be empty')
    }
    return new UsersId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: UsersId): boolean {
    return this.value === other.value
  }
}
