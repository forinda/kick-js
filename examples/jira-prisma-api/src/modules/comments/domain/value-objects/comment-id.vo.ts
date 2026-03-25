/**
 * Comment ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   CommentId.create()    — generate a new UUID
 *   CommentId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class CommentId {
  private constructor(private readonly value: string) {}

  static create(): CommentId {
    return new CommentId(randomUUID())
  }

  static from(id: string): CommentId {
    if (!id || id.trim().length === 0) {
      throw new Error('CommentId cannot be empty')
    }
    return new CommentId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: CommentId): boolean {
    return this.value === other.value
  }
}
