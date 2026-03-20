/**
 * Products Entity
 *
 * Domain layer — the core business object.
 * Uses a private constructor with static factory methods (create, reconstitute)
 * to enforce invariants. Properties are accessed via getters to maintain encapsulation.
 *
 * Patterns used:
 *   - Private constructor: prevents direct instantiation
 *   - create(): factory for new entities (generates ID, sets timestamps)
 *   - reconstitute(): factory for rebuilding from persistence (no side effects)
 *   - changeName(): mutation method that enforces business rules
 */
import { ProductsId } from '../value-objects/products-id.vo'

interface ProductsProps {
  id: ProductsId
  name: string
  createdAt: Date
  updatedAt: Date
}

export class Products {
  private constructor(private props: ProductsProps) {}

  static create(params: { name: string }): Products {
    const now = new Date()
    return new Products({
      id: ProductsId.create(),
      name: params.name,
      createdAt: now,
      updatedAt: now,
    })
  }

  static reconstitute(props: ProductsProps): Products {
    return new Products(props)
  }

  get id(): ProductsId {
    return this.props.id
  }
  get name(): string {
    return this.props.name
  }
  get createdAt(): Date {
    return this.props.createdAt
  }
  get updatedAt(): Date {
    return this.props.updatedAt
  }

  changeName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('Name cannot be empty')
    }
    this.props.name = name.trim()
    this.props.updatedAt = new Date()
  }

  toJSON() {
    return {
      id: this.props.id.toString(),
      name: this.props.name,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    }
  }
}
