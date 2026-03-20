import { Service, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB, DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'
import { eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc } from 'drizzle-orm'
import { products } from '../../db/schema'
import type { ParsedQuery } from '@forinda/kickjs-http'

const queryAdapter = new DrizzleQueryAdapter({
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  ilike,
  inArray,
  and,
  or,
  asc,
  desc,
})

@Service()
export class ProductsService {
  constructor(@Inject(DRIZZLE_DB) private db: any) {}

  findAll(parsed: ParsedQuery) {
    const query = queryAdapter.build(parsed, {
      table: products,
      searchColumns: ['name', 'description', 'category'],
    })

    let q = this.db.select().from(products)

    if (query.where) {
      q = q.where(query.where)
    }
    if (query.orderBy.length > 0) {
      q = q.orderBy(...query.orderBy)
    }

    return q.limit(query.limit).offset(query.offset).all()
  }

  findById(id: number) {
    return this.db.select().from(products).where(eq(products.id, id)).get()
  }

  create(data: {
    name: string
    description?: string
    price: number
    stock?: number
    category: string
  }) {
    return this.db.insert(products).values(data).returning().get()
  }

  update(
    id: number,
    data: Partial<{
      name: string
      description: string
      price: number
      stock: number
      category: string
    }>,
  ) {
    return this.db.update(products).set(data).where(eq(products.id, id)).returning().get()
  }

  delete(id: number) {
    return this.db.delete(products).where(eq(products.id, id)).returning().get()
  }
}
