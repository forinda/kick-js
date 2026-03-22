import { Service, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB, DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'
import { eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc, count } from 'drizzle-orm'
import { users, posts } from '@/db/schema'
import { USERS_QUERY_CONFIG } from '../../constants'
import type { AppDatabase } from '@/db'
import type { IUsersRepository } from '../../domain/repositories/users.repository'
import type { CreateUsersDTO } from '../../application/dtos/create-users.dto'
import type { UpdateUsersDTO } from '../../application/dtos/update-users.dto'
import type { ParsedQuery } from '@forinda/kickjs-http'

const queryAdapter = new DrizzleQueryAdapter({
  eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc,
})

@Service()
export class DrizzleUsersRepository implements IUsersRepository {
  constructor(@Inject(DRIZZLE_DB) private db: AppDatabase) {}

  async findById(id: string) {
    return this.db.select().from(users).where(eq(users.id, Number(id))).get() ?? null
  }

  async findAll() {
    return this.db.select().from(users).all()
  }

  async findPaginated(parsed: ParsedQuery) {
    const query = queryAdapter.buildFromColumns(parsed, USERS_QUERY_CONFIG)

    const data = this.db
      .select().from(users).$dynamic()
      .where(query.where).orderBy(...query.orderBy)
      .limit(query.limit).offset(query.offset).all()

    const totalResult = this.db
      .select({ count: count() }).from(users)
      .$dynamic().where(query.where).get()

    return { data, total: totalResult?.count ?? 0 }
  }

  async create(dto: CreateUsersDTO) {
    return this.db.insert(users).values(dto).returning().get()
  }

  async createWithPost(dto: CreateUsersDTO) {
    return this.db.transaction((tx) => {
      const user = tx.insert(users).values(dto).returning().get()
      tx.insert(posts).values({
        title: `Welcome ${user.name}!`,
        content: `${user.name} joined the platform.`,
        published: true,
        authorId: user.id,
      }).run()
      return user
    })
  }

  async update(id: string, dto: UpdateUsersDTO) {
    return this.db.update(users).set(dto).where(eq(users.id, Number(id))).returning().get()
  }

  async delete(id: string) {
    this.db.delete(users).where(eq(users.id, Number(id))).run()
  }
}
