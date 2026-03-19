import { ProductsId } from '../value-objects/products-id.vo'

interface ProductsProps {
  id: ProductsId
  name: string
  description?: string
  price: number
  category: string
  status: string
  tags: string[]
  sku?: string
  stock: number
  createdAt: Date
  updatedAt: Date
}

export class Products {
  private constructor(private props: ProductsProps) {}

  static create(params: {
    name: string
    description?: string
    price: number
    category: string
    status: string
    tags?: string[]
    sku?: string
    stock: number
  }): Products {
    const now = new Date()
    return new Products({
      id: ProductsId.create(),
      name: params.name,
      description: params.description,
      price: params.price,
      category: params.category,
      status: params.status,
      tags: params.tags ?? [],
      sku: params.sku,
      stock: params.stock,
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
  get description(): string | undefined {
    return this.props.description
  }
  get price(): number {
    return this.props.price
  }
  get category(): string {
    return this.props.category
  }
  get status(): string {
    return this.props.status
  }
  get tags(): string[] {
    return this.props.tags
  }
  get sku(): string | undefined {
    return this.props.sku
  }
  get stock(): number {
    return this.props.stock
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
      description: this.props.description,
      price: this.props.price,
      category: this.props.category,
      status: this.props.status,
      tags: this.props.tags,
      sku: this.props.sku,
      stock: this.props.stock,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    }
  }
}
