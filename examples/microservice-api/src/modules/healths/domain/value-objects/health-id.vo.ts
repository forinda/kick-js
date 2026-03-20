/**
 * Health ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   HealthId.create()    — generate a new UUID
 *   HealthId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class HealthId {
  private constructor(private readonly value: string) {}

  static create(): HealthId {
    return new HealthId(randomUUID())
  }

  static from(id: string): HealthId {
    if (!id || id.trim().length === 0) {
      throw new Error('HealthId cannot be empty')
    }
    return new HealthId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: HealthId): boolean {
    return this.value === other.value
  }
}
