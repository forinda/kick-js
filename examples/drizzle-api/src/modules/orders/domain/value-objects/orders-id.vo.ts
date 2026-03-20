/**
 * Orders ID Value Object
 *
 * Domain layer — wraps a primitive ID with type safety and validation.
 * Value objects are immutable and compared by value, not reference.
 *
 *   OrdersId.create()    — generate a new UUID
 *   OrdersId.from(id)    — wrap an existing ID string (validates non-empty)
 *   id.equals(other)  — compare two IDs by value
 */
import { randomUUID } from 'node:crypto'

export class OrdersId {
  private constructor(private readonly value: string) {}

  static create(): OrdersId {
    return new OrdersId(randomUUID())
  }

  static from(id: string): OrdersId {
    if (!id || id.trim().length === 0) {
      throw new Error('OrdersId cannot be empty')
    }
    return new OrdersId(id)
  }

  toString(): string {
    return this.value
  }

  equals(other: OrdersId): boolean {
    return this.value === other.value
  }
}
