/**
 * Workspace ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   WorkspaceId.create()    — generate a new UUID
 *   WorkspaceId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class WorkspaceId {
  private constructor(private readonly value: string) {}

  static create(): WorkspaceId {
    return new WorkspaceId(randomUUID())
  }

  static from(id: string): WorkspaceId {
    if (!id || id.trim().length === 0) {
      throw new Error('WorkspaceId cannot be empty')
    }
    return new WorkspaceId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: WorkspaceId): boolean {
    return this.value === other.value
  }
}
