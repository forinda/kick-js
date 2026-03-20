import { Service, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { eq } from 'drizzle-orm'
import { users } from '../../db/schema'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '../../db/schema'

@Service()
export class UsersService {
  constructor(@Inject(DRIZZLE_DB) private db: BetterSQLite3Database<typeof schema>) {}

  findAll() {
    return this.db.select().from(users).all()
  }

  findById(id: number) {
    return this.db.select().from(users).where(eq(users.id, id)).get()
  }

  create(data: { name: string; email: string; role?: 'admin' | 'user' | 'editor' }) {
    return this.db.insert(users).values(data).returning().get()
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
