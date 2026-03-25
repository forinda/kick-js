# Examples

KickJS ships with example applications that demonstrate different features and patterns. Each example was scaffolded using the CLI (`kick new` + `kick g module`) and then customized.

## Full Applications

### Jira Clone (Drizzle)

**What it shows:** A full-featured project management API with PostgreSQL and Drizzle ORM.

- 14 DDD modules: auth, users, workspaces, projects, tasks, labels, comments, attachments, channels, messages, notifications, activities, stats
- JWT authentication with refresh token rotation
- Real-time updates via WebSocket and SSE
- Background jobs (BullMQ) for email, notifications, activity logging
- Cron jobs for token cleanup, overdue reminders, daily digests
- Swagger UI at `/docs`, DevTools at `/_debug`

[View source](https://github.com/forinda/kick-js/tree/main/examples/jira-drizzle-api) | [Full docs](./jira-drizzle-api)

### Jira Clone (Prisma)

**What it shows:** The same Jira clone using Prisma ORM with PostgreSQL instead of Drizzle.

- Same 14 modules with Prisma Client repositories
- Declarative `schema.prisma` with auto-generated client
- `@forinda/kickjs-prisma` adapter with `PRISMA_CLIENT` DI token
- `prisma db push` for schema sync, `prisma migrate` for production

[View source](https://github.com/forinda/kick-js/tree/main/examples/jira-prisma-api) | [Full docs](./jira-prisma-api)

### Jira Clone (Mongoose)

**What it shows:** The same Jira clone using MongoDB and Mongoose instead of PostgreSQL.

- Same 14 modules with MongoDB document schemas
- Uses `@forinda/kickjs-auth` adapter with `@Public()` decorator
- Per-module schema files in `infrastructure/schemas/`
- Resend email provider integration
- CORS, Helmet, Morgan middleware

[View source](https://github.com/forinda/kick-js/tree/main/examples/jira-mongoose-api) | [Full docs](./jira-mongoose-api)

## Focused Examples

### Minimal

The simplest possible KickJS app — `bootstrap()` and one route, ~10 lines of code.

[View source](https://github.com/forinda/kick-js/tree/main/examples/minimal-api) | [Full docs](./minimal-api)

### Joi Validation

Swagger integration using Joi schemas instead of Zod via a custom `SchemaParser`.

[View source](https://github.com/forinda/kick-js/tree/main/examples/joi-api) | [Full docs](./joi-api)

### DevTools

`DevToolsAdapter` with reactive state, debug endpoints, and config exposure.

[View source](https://github.com/forinda/kick-js/tree/main/examples/devtools-api) | [Full docs](./devtools-api)

### GraphQL

GraphQL API with `@Resolver`, `@Query`, `@Mutation` decorators and GraphiQL playground.

[View source](https://github.com/forinda/kick-js/tree/main/examples/graphql-api) | [Full docs](./graphql-api)

### Microservice

REST API with OpenTelemetry, DevTools, and Swagger — the microservice template.

[View source](https://github.com/forinda/kick-js/tree/main/examples/microservice-api) | [Full docs](./microservice-api)

### OpenTelemetry

Task CRUD API with automatic request tracing via console span exporter.

[View source](https://github.com/forinda/kick-js/tree/main/examples/otel-api) | [Full docs](./otel-api)

## Running Examples

```bash
# Clone the repo
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install
pnpm build

# Run any example
cd examples/minimal-api
kick dev
```

## Creating Your Own

```bash
npx @forinda/kickjs-cli new my-api
cd my-api
pnpm install
pnpm kick g module users
pnpm kick dev
```
