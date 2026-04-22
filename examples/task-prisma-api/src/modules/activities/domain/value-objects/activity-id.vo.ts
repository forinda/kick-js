/**
 * Activity ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   ActivityId.create()    — generate a new UUID
 *   ActivityId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class ActivityId {
  private constructor(private readonly value: string) {}

  static create(): ActivityId {
    return new ActivityId(randomUUID())
  }

  static from(id: string): ActivityId {
    if (!id || id.trim().length === 0) {
      throw new Error('ActivityId cannot be empty')
    }
    return new ActivityId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: ActivityId): boolean {
    return this.value === other.value
  }
}
