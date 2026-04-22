/**
 * Task ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   TaskId.create()    — generate a new UUID
 *   TaskId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class TaskId {
  private constructor(private readonly value: string) {}

  static create(): TaskId {
    return new TaskId(randomUUID())
  }

  static from(id: string): TaskId {
    if (!id || id.trim().length === 0) {
      throw new Error('TaskId cannot be empty')
    }
    return new TaskId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: TaskId): boolean {
    return this.value === other.value
  }
}
