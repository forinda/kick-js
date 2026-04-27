export default {
  db: {
    schemaPath: './packages/db/__tests__/fixtures/schema.demo.ts',
    migrationsDir: './packages/db/__tests__/fixtures/migrations',
    dialect: 'postgres' as const,
  },
}
