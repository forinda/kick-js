/**
 * Channel ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   ChannelId.create()    — generate a new UUID
 *   ChannelId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class ChannelId {
  private constructor(private readonly value: string) {}

  static create(): ChannelId {
    return new ChannelId(randomUUID())
  }

  static from(id: string): ChannelId {
    if (!id || id.trim().length === 0) {
      throw new Error('ChannelId cannot be empty')
    }
    return new ChannelId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: ChannelId): boolean {
    return this.value === other.value
  }
}
