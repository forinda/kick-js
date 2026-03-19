import { randomUUID } from 'node:crypto'

export class TodoId {
  private constructor(private readonly value: string) {}

  static create(): TodoId {
    return new TodoId(randomUUID())
  }

  static from(id: string): TodoId {
    if (!id || id.trim().length === 0) {
      throw new Error('TodoId cannot be empty')
    }
    return new TodoId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: TodoId): boolean {
    return this.value === other.value
  }
}
