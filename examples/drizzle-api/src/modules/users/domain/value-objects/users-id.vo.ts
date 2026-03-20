/**
 * Users ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   UsersId.create()    — generate a new UUID
 *   UsersId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
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
