import type { ParsedQuery } from '@forinda/kickjs-http'
import type { User, Prisma } from '@/generated/prisma/client'

export type { User }
export type NewUser = Prisma.UserCreateInput

export interface IUserRepository {
  findById(id: string): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  findAll(): Promise<User[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: User[]; total: number }>
  create(dto: any): Promise<User>
  update(id: string, dto: any): Promise<User>
  delete(id: string): Promise<void>
}

export const USER_REPOSITORY = Symbol('IUserRepository')
