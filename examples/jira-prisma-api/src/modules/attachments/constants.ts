import type { PrismaQueryConfig } from '@forinda/kickjs-prisma'

export const ATTACHMENT_QUERY_CONFIG: PrismaQueryConfig = {
  searchColumns: ['fileName'],
}
