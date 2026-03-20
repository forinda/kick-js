import { Service, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB, DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'
import { eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc, count } from 'drizzle-orm'
import { products } from '@/db/schema'
import type { AppDatabase } from '@/db'
import type { IProductsRepository } from '../../domain/repositories/products.repository'
import type { CreateProductsDTO } from '../../application/dtos/create-products.dto'
import type { UpdateProductsDTO } from '../../application/dtos/update-products.dto'
import type { ParsedQuery } from '@forinda/kickjs-http'

const queryAdapter = new DrizzleQueryAdapter({
  eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc,
})

@Service()
export class DrizzleProductsRepository implements IProductsRepository {
  constructor(@Inject(DRIZZLE_DB) private db: AppDatabase) {}

  async findById(id: string) {
    return this.db.select().from(products).where(eq(products.id, Number(id))).get() ?? null
  }

  async findAll() {
    return this.db.select().from(products).all()
  }

  async findPaginated(parsed: ParsedQuery) {
    const query = queryAdapter.build(parsed, {
      table: products,
      searchColumns: ['name', 'description', 'category'],
    })

    const data = this.db
      .select().from(products).$dynamic()
      .where(query.where).orderBy(...query.orderBy)
      .limit(query.limit).offset(query.offset).all()

    const totalResult = this.db
      .select({ count: count() }).from(products)
      .$dynamic().where(query.where).get()

    return { data, total: totalResult?.count ?? 0 }
  }

  async create(dto: CreateProductsDTO) {
    return this.db.insert(products).values(dto).returning().get()
  }

  async update(id: string, dto: UpdateProductsDTO) {
    return this.db.update(products).set(dto).where(eq(products.id, Number(id))).returning().get()
  }

  async delete(id: string) {
    this.db.delete(products).where(eq(products.id, Number(id))).run()
  }
}
