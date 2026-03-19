/**
 * Post ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   PostId.create()    — generate a new UUID
 *   PostId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class PostId {
  private constructor(private readonly value: string) {}

  static create(): PostId {
    return new PostId(randomUUID())
  }

  static from(id: string): PostId {
    if (!id || id.trim().length === 0) {
      throw new Error('PostId cannot be empty')
    }
    return new PostId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: PostId): boolean {
    return this.value === other.value
  }
}
