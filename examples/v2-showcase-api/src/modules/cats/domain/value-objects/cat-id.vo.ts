/**
 * Cat ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   CatId.create()    — generate a new UUID
 *   CatId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class CatId {
  private constructor(private readonly value: string) {}

  static create(): CatId {
    return new CatId(randomUUID())
  }

  static from(id: string): CatId {
    if (!id || id.trim().length === 0) {
      throw new Error('CatId cannot be empty')
    }
    return new CatId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: CatId): boolean {
    return this.value === other.value
  }
}
