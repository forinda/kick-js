# {{name}}

A **{{templateLabel}}** built with [KickJS](https://kickjs.app/) — a decorator-driven Node.js framework for TypeScript that runs on Express, Fastify, or h3 (swap the engine in one line).

## Getting Started

```bash
{{packageManager}} install
kick dev
```

## Scripts

| Command                              | Description                          |
| ------------------------------------ | ------------------------------------ |
| `kick dev`                           | Start dev server with Vite HMR       |
| `kick build`                         | Production build                     |
| `kick start`                         | Run production build                 |
| `{{packageManager}} run test`        | Run tests with Vitest                |
| `kick g module <name>`               | Generate a DDD module                |
| `kick g scaffold <name> <fields...>` | Generate CRUD from field definitions |
| `kick add <package>`                 | Add a KickJS package                 |

## Project Structure

```
src/
├── index.ts           # Application entry point
├── modules/           # Feature modules (controllers, services, repos)
│   └── index.ts       # Module registry
└── ...
```

## Packages

{{packages}}

## Adding Features

```bash
kick add swagger       # OpenAPI documentation
kick add ws            # WebSocket support
kick add queue         # Background job processing
kick add --list        # Show all available packages
```

For email, scheduled tasks, multi-tenancy, OpenTelemetry, GraphQL, and notifications use the BYO recipes in the [KickJS guides](https://kickjs.app/guide/) — they wire the upstream library through `defineAdapter()` / `definePlugin()` directly, so you keep control of the integration.

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable    | Default       | Description                    |
| ----------- | ------------- | ------------------------------ |
| `PORT`      | `3000`        | Server port                    |
| `NODE_ENV`  | `development` | Environment                    |
| `LOG_LEVEL` | `info`        | Log level (`debug` shows more) |

The env schema lives in `src/config/index.ts`. `src/index.ts` imports it once (`import './config'`) before `bootstrap()`, which registers and validates it — a missing or malformed value fails at startup with a clear message. To add a variable, add it to the schema, then to `.env` and `.env.example`.

You don't import anything from `src/config` after that. Read values anywhere through the framework, not `process.env` — they come back parsed (`PORT` is a number, defaults applied) and typed:

```ts
import { getEnv } from '@forinda/kickjs'

const port = getEnv('PORT') // number

// For a key the schema marks optional, a fallback for when it's unset:
// const region = getEnv('S3_REGION', 'eu-west-1')
```

In services and controllers, inject `ConfigService`, or a single value with `@Value`:

```ts
import { Autowired, ConfigService, Service, Value, type Env } from '@forinda/kickjs'

@Service()
export class StatusService {
  @Autowired() private readonly config!: ConfigService
  @Value('NODE_ENV') private readonly nodeEnv!: Env<'NODE_ENV'> // the schema's type

  status() {
    return {
      env: this.nodeEnv,
      logLevel: this.config.get('LOG_LEVEL'), // typed from the schema
      port: this.config.getAll().PORT, // getAll(): every validated value
    }
  }
}
```

Keys and types come from the schema: `kick dev` keeps them up to date as you edit it (or run `kick typegen`), so a misspelt key is a type error.

## Learn More

- [KickJS Documentation](https://kickjs.app/)
- [CLI Reference](https://kickjs.app/api/cli.html)
