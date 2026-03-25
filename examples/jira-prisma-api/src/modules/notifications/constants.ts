import type { PrismaQueryConfig } from '@forinda/kickjs-prisma'

export const NOTIFICATION_QUERY_CONFIG: PrismaQueryConfig = {
  searchColumns: ['title', 'body'],
}
