import type { PrismaQueryConfig } from '@forinda/kickjs-prisma'

export const TASK_QUERY_CONFIG: PrismaQueryConfig = {
  searchColumns: ['title', 'key'],
}
