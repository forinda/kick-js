import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

const client = postgres(connectionString, { max: 10 })

export const db = drizzle(client, { schema })

export type AppDatabase = typeof db

export { client }
