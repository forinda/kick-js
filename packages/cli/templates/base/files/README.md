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

| Variable   | Default       | Description |
| ---------- | ------------- | ----------- |
| `PORT`     | `3000`        | Server port |
| `NODE_ENV` | `development` | Environment |

## Learn More

- [KickJS Documentation](https://kickjs.app/)
- [CLI Reference](https://kickjs.app/api/cli.html)
