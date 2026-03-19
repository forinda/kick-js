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
