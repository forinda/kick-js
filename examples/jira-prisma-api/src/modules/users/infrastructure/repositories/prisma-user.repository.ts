import { Repository, Inject, HttpException } from '@forinda/kickjs'
import { PRISMA_CLIENT } from '@forinda/kickjs-prisma'
import type { PrismaClient } from '@prisma/client'
import type { ParsedQuery } from '@forinda/kickjs'
import type { IUserRepository } from '../../domain/repositories/user.repository'
import type { CreateUserDTO } from '../../application/dtos/create-user.dto'
import type { UpdateUserDTO } from '../../application/dtos/update-user.dto'

import { queryAdapter } from '@/shared/infrastructure/query-adapter'

@Repository()
export class PrismaUserRepository implements IUserRepository {
  constructor(@Inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } })
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } })
  }

  async findAll() {
    return this.prisma.user.findMany()
  }

  async findPaginated(parsed: ParsedQuery) {
    const query = queryAdapter.build(parsed, { searchColumns: ['firstName', 'lastName', 'email'] })

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where: query.where,
        orderBy: query.orderBy,
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.user.count({ where: query.where }),
    ])

    return { data, total }
  }

  async create(dto: CreateUserDTO) {
    return this.prisma.user.create({ data: dto })
  }

  async update(id: string, dto: UpdateUserDTO) {
    const user = await this.prisma.user.update({ where: { id }, data: dto }).catch(() => null)
    if (!user) throw HttpException.notFound('User not found')
    return user
  }

  async delete(id: string) {
    await this.prisma.user.delete({ where: { id } })
  }
}
