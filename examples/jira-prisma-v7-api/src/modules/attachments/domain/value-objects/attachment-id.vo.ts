/**
 * Attachment ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   AttachmentId.create()    — generate a new UUID
 *   AttachmentId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class AttachmentId {
  private constructor(private readonly value: string) {}

  static create(): AttachmentId {
    return new AttachmentId(randomUUID())
  }

  static from(id: string): AttachmentId {
    if (!id || id.trim().length === 0) {
      throw new Error('AttachmentId cannot be empty')
    }
    return new AttachmentId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: AttachmentId): boolean {
    return this.value === other.value
  }
}
