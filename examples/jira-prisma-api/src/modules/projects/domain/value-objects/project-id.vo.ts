/**
 * Project ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   ProjectId.create()    — generate a new UUID
 *   ProjectId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class ProjectId {
  private constructor(private readonly value: string) {}

  static create(): ProjectId {
    return new ProjectId(randomUUID())
  }

  static from(id: string): ProjectId {
    if (!id || id.trim().length === 0) {
      throw new Error('ProjectId cannot be empty')
    }
    return new ProjectId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: ProjectId): boolean {
    return this.value === other.value
  }
}
