# @forinda/kickjs-config

Type-safe environment configuration with Zod validation and an injectable config service.

## defineEnv

Define a custom env schema by extending the base schema (PORT, NODE_ENV, LOG_LEVEL).

```typescript
function defineEnv<T extends z.ZodRawShape>(
  extend: (base: typeof baseEnvSchema) => z.ZodObject<any>,
): z.ZodObject<any>
```

**Example:**

```typescript
const envSchema = defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
  })
)
```

## loadEnv

Parse and validate `process.env` against a Zod schema. Result is cached after first call.

```typescript
function loadEnv<T extends z.ZodObject<any>>(schema?: T): z.infer<T>
```

## getEnv

Get a single environment variable value from the cached config.

```typescript
function getEnv<K extends string>(key: K): any
```

## resetEnvCache

Clear the cached env config. Useful in tests to re-parse with different values.

```typescript
function resetEnvCache(): void
```

## baseEnvSchema

Built-in Zod schema with common server variables.

```typescript
const baseEnvSchema: z.ZodObject<{
  PORT: z.ZodDefault<z.ZodNumber>           // default: 3000
  NODE_ENV: z.ZodDefault<z.ZodEnum<['development', 'production', 'test']>>  // default: 'development'
  LOG_LEVEL: z.ZodDefault<z.ZodString>      // default: 'info'
}>
```

## ConfigService

Injectable service for accessing typed environment configuration. Registered automatically via `@Service()`.

```typescript
@Service()
class ConfigService {
  get<T = any>(key: string): T
  getAll(): Readonly<Record<string, any>>
  isProduction(): boolean
  isDevelopment(): boolean
  isTest(): boolean
}
```

## Types

```typescript
type Env = { PORT: number; NODE_ENV: 'development' | 'production' | 'test'; LOG_LEVEL: string }
```
