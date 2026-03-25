/**
 * Notification ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   NotificationId.create()    — generate a new UUID
 *   NotificationId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class NotificationId {
  private constructor(private readonly value: string) {}

  static create(): NotificationId {
    return new NotificationId(randomUUID())
  }

  static from(id: string): NotificationId {
    if (!id || id.trim().length === 0) {
      throw new Error('NotificationId cannot be empty')
    }
    return new NotificationId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: NotificationId): boolean {
    return this.value === other.value
  }
}
