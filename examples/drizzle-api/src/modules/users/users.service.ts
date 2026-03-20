import { Service, Inject } from '@forinda/kickjs-core'
import { DRIZZLE_DB } from '@forinda/kickjs-drizzle'
import { eq } from 'drizzle-orm'
import { users } from '../../db/schema'

@Service()
export class UsersService {
  constructor(@Inject(DRIZZLE_DB) private db: any) {}

  findAll() {
    return this.db.select().from(users).all()
  }

  findById(id: number) {
    return this.db.select().from(users).where(eq(users.id, id)).get()
  }

  create(data: { name: string; email: string; role?: string }) {
    return this.db.insert(users).values(data).returning().get()
  }

  update(id: number, data: Partial<{ name: string; email: string; role: string }>) {
    return this.db.update(users).set(data).where(eq(users.id, id)).returning().get()
  }

  delete(id: number) {
    return this.db.delete(users).where(eq(users.id, id)).returning().get()
  }
}
