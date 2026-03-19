import { randomUUID } from 'node:crypto'

export class DocumentsId {
  private constructor(private readonly value: string) {}

  static create(): DocumentsId {
    return new DocumentsId(randomUUID())
  }

  static from(id: string): DocumentsId {
    if (!id || id.trim().length === 0) {
      throw new Error('DocumentsId cannot be empty')
    }
    return new DocumentsId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: DocumentsId): boolean {
    return this.value === other.value
  }
}
