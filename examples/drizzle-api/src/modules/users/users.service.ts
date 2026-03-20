import { Service, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB, DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'
import { eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc } from 'drizzle-orm'
import { users, posts } from '@/db/schema'
import type { AppDatabase } from '@/db'
import type { ParsedQuery } from '@forinda/kickjs-http'

const queryAdapter = new DrizzleQueryAdapter({
  eq, ne, gt, gte, lt, lte, ilike, inArray, and, or, asc, desc,
})

@Service()
export class UsersService {
  constructor(@Inject(DRIZZLE_DB) private db: AppDatabase) {}

  findAll(parsed: ParsedQuery) {
    const query = queryAdapter.build(parsed, {
      table: users,
      searchColumns: ['name', 'email'],
    })

    return this.db
      .select()
      .from(users)
      .$dynamic()
      .where(query.where)
      .orderBy(...query.orderBy)
      .limit(query.limit)
      .offset(query.offset)
      .all()
  }

  findById(id: number) {
    return this.db.select().from(users).where(eq(users.id, id)).get()
  }

  create(data: { name: string; email: string; role?: 'admin' | 'user' | 'editor' }) {
    return this.db.insert(users).values(data).returning().get()
  }

  /** Create a user with a welcome post in a single transaction */
  createWithPost(data: { name: string; email: string; role?: 'admin' | 'user' | 'editor' }) {
    return this.db.transaction((tx) => {
      const user = tx.insert(users).values(data).returning().get()
      tx.insert(posts)
        .values({
          title: `Welcome ${user.name}!`,
          content: `${user.name} joined the platform.`,
          published: true,
          authorId: user.id,
        })
        .run()
      return user
    })
  }

  update(
    id: number,
    data: Partial<{ name: string; email: string; role: 'admin' | 'user' | 'editor' }>,
  ) {
    return this.db.update(users).set(data).where(eq(users.id, id)).returning().get()
  }

  delete(id: number) {
    return this.db.delete(users).where(eq(users.id, id)).returning().get()
  }
}
