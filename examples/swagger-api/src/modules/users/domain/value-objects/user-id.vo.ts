/**
 * User ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   UserId.create()    — generate a new UUID
 *   UserId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class UserId {
  private constructor(private readonly value: string) {}

  static create(): UserId {
    return new UserId(randomUUID())
  }

  static from(id: string): UserId {
    if (!id || id.trim().length === 0) {
      throw new Error('UserId cannot be empty')
    }
    return new UserId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: UserId): boolean {
    return this.value === other.value
  }
}
