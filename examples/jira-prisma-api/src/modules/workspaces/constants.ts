import type { PrismaQueryConfig } from '@forinda/kickjs-prisma'

export const WORKSPACE_QUERY_CONFIG: PrismaQueryConfig = {
  searchColumns: ['name', 'slug'],
}
