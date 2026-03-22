import { eq, ne, gt, gte, lt, lte, ilike, inArray, between, and, or, asc, desc } from 'drizzle-orm'
import { DrizzleQueryAdapter } from '@forinda/kickjs-drizzle'

export const queryAdapter = new DrizzleQueryAdapter({
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  ilike,
  inArray,
  between,
  and,
  or,
  asc,
  desc,
})
