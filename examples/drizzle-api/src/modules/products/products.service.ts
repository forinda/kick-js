import { Service, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB, DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'
import { eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc, count } from 'drizzle-orm'
import { products } from '@/db/schema'
import type { AppDatabase } from '@/db'
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
  constructor(@Inject(DRIZZLE_DB) private db: AppDatabase) {}

  async findAll(parsed: ParsedQuery) {
    const query = queryAdapter.build(parsed, {
      table: products,
      searchColumns: ['name', 'description', 'category'],
    })

    const data = this.db
      .select()
      .from(products)
      .$dynamic()
      .where(query.where)
      .orderBy(...query.orderBy)
      .limit(query.limit)
      .offset(query.offset)
      .all()

    const totalResult = this.db
      .select({ count: count() })
      .from(products)
      .$dynamic()
      .where(query.where)
      .get()

    return { data, total: totalResult?.count ?? 0 }
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
