import { Repository, Inject, HttpException } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { ParsedQuery } from '@forinda/kickjs-http'
import { users } from '@/db/schema'
import type { IUserRepository } from '../../domain/repositories/user.repository'
import type { CreateUserDTO } from '../../application/dtos/create-user.dto'
import type { UpdateUserDTO } from '../../application/dtos/update-user.dto'
import { USER_QUERY_CONFIG } from '../../constants'
import { AppDatabase } from '@/db'
import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class DrizzleUserRepository implements IUserRepository {
  constructor(@Inject(DRIZZLE_DB) private db: AppDatabase) {}

  async findById(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id))
    return user ?? null
  }

  async findByEmail(email: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email))
    return user ?? null
  }

  async findAll() {
    return this.db.select().from(users)
  }

  async findPaginated(parsed: ParsedQuery) {
    const query = queryAdapter.buildFromColumns(parsed, USER_QUERY_CONFIG)

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(query.where),
    ])

    return { data, total: countResult[0]?.count ?? 0 }
  }

  async create(dto: CreateUserDTO) {
    const [user] = await this.db.insert(users).values(dto).returning()
    return user
  }

  async update(id: string, dto: UpdateUserDTO) {
    const [user] = await this.db.update(users).set(dto).where(eq(users.id, id)).returning()
    if (!user) throw HttpException.notFound('User not found')
    return user
  }

  async delete(id: string) {
    await this.db.delete(users).where(eq(users.id, id))
  }
}
