import type { PrismaQueryConfig } from '@forinda/kickjs-prisma'

export const USER_QUERY_CONFIG: PrismaQueryConfig = {
  searchColumns: ['firstName', 'lastName', 'email'],
}
