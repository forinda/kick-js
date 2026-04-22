import type { ParsedQuery } from '@forinda/kickjs'
import type { users } from '@/db/schema'

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export interface IUserRepository {
  findById(id: string): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  findAll(): Promise<User[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: User[]; total: number }>
  create(dto: NewUser): Promise<User>
  update(id: string, dto: Partial<NewUser>): Promise<User>
  delete(id: string): Promise<void>
}

export const USER_REPOSITORY = Symbol('IUserRepository')
