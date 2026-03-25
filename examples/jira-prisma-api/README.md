# kick-jira-app-prisma

A **REST API** built with [KickJS](https://forinda.github.io/kick-js/) — a decorator-driven Node.js framework on Express 5 and TypeScript, using **Prisma** as the ORM.

## Getting Started

```bash
pnpm install
kick dev
```

## Scripts

| Command | Description |
|---|---|
| `kick dev` | Start dev server with Vite HMR |
| `kick build` | Production build |
| `kick start` | Run production build |
| `pnpm run test` | Run tests with Vitest |
| `kick g module <name>` | Generate a DDD module |
| `kick g scaffold <name> <fields...>` | Generate CRUD from field definitions |
| `kick add <package>` | Add a KickJS package |

## Project Structure

```
src/
├── index.ts           # Application entry point
├── modules/           # Feature modules (controllers, services, repos)
│   └── index.ts       # Module registry
└── ...
```

## Packages

- `@forinda/kickjs-core`
- `@forinda/kickjs-http`
- `@forinda/kickjs-config`
- `@forinda/kickjs-prisma`
- `@forinda/kickjs-swagger`
- `@forinda/kickjs-devtools`

## Adding Features

```bash
kick add auth          # Authentication (JWT, API key, OAuth)
kick add swagger       # OpenAPI documentation
kick add ws            # WebSocket support
kick add queue         # Background job processing
kick add mailer        # Email sending
kick add cron          # Scheduled tasks
kick add --list        # Show all available packages
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment |

## Learn More

- [KickJS Documentation](https://forinda.github.io/kick-js/)
- [CLI Reference](https://forinda.github.io/kick-js/api/cli.html)
