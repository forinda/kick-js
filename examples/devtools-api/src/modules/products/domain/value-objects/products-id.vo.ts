/**
 * Products ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   ProductsId.create()    — generate a new UUID
 *   ProductsId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class ProductsId {
  private constructor(private readonly value: string) {}

  static create(): ProductsId {
    return new ProductsId(randomUUID())
  }

  static from(id: string): ProductsId {
    if (!id || id.trim().length === 0) {
      throw new Error('ProductsId cannot be empty')
    }
    return new ProductsId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: ProductsId): boolean {
    return this.value === other.value
  }
}
