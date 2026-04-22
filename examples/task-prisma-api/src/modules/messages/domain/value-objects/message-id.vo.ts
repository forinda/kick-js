/**
 * Message ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   MessageId.create()    — generate a new UUID
 *   MessageId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class MessageId {
  private constructor(private readonly value: string) {}

  static create(): MessageId {
    return new MessageId(randomUUID())
  }

  static from(id: string): MessageId {
    if (!id || id.trim().length === 0) {
      throw new Error('MessageId cannot be empty')
    }
    return new MessageId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: MessageId): boolean {
    return this.value === other.value
  }
}
