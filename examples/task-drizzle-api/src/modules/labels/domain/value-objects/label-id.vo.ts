/**
 * Label ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   LabelId.create()    — generate a new UUID
 *   LabelId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class LabelId {
  private constructor(private readonly value: string) {}

  static create(): LabelId {
    return new LabelId(randomUUID())
  }

  static from(id: string): LabelId {
    if (!id || id.trim().length === 0) {
      throw new Error('LabelId cannot be empty')
    }
    return new LabelId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: LabelId): boolean {
    return this.value === other.value
  }
}
