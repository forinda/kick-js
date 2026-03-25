# @forinda/kickjs-cli

CLI for KickJS — project scaffolding, DDD module generation, dev/build/start commands.

## Install

```bash
# Using the KickJS CLI (recommended — installs as dev dependency)
kick add cli

# Manual install
pnpm add -D @forinda/kickjs-cli
```

## Commands

```bash
kick new <name>           # Scaffold a new KickJS project
kick dev                  # Start dev server with Vite HMR
kick build                # Production build via Vite
kick start                # Run production build
kick info                 # Print system and framework info

kick g module <names...>  # Generate one or more DDD modules
kick g scaffold <name>    # Generate CRUD module from field definitions
kick g controller <name>  # Generate controller
kick g service <name>     # Generate service
kick g middleware <name>  # Generate middleware
kick g guard <name>       # Generate auth guard
kick g adapter <name>     # Generate lifecycle adapter
kick g dto <name>         # Generate DTO with Zod schema

kick rm module <names...> # Remove one or more modules
kick add <pkg>            # Install a KickJS package + peers
kick add --list           # Show all available packages
```

## Generator Flags

```bash
kick g module users --no-entity       # Skip entity/value objects
kick g module users --no-tests        # Skip test files
kick g module users --minimal         # Only index.ts + controller
kick g module users --dry-run         # Preview without writing
kick g module users --repo prisma     # Use Prisma repository (working code)
kick g module users --repo drizzle    # Use Drizzle repository (working code)
kick g module users --no-pluralize    # Singular names: src/modules/user/
```

## Repository Types

The `--repo` flag or `defaultRepo` config controls the generated repository implementation:

| Type | File | Code |
|------|------|------|
| `inmemory` (default) | `in-memory-{name}.repository.ts` | Working Map-based store |
| `drizzle` | `drizzle-{name}.repository.ts` | Working Drizzle ORM queries |
| `prisma` | `prisma-{name}.repository.ts` | Working Prisma Client queries |
| `{ name: 'custom' }` | `custom-{name}.repository.ts` | In-memory stub with TODO markers |

Custom repo types accept any string and generate a stub repository with the correct class/file naming:

```bash
kick g module user --repo typeorm     # → typeorm-user.repository.ts, TypeormUserRepository
kick g module user --repo mongoose    # → mongoose-user.repository.ts, MongooseUserRepository
```

## Configuration

Configure defaults in `kick.config.ts`:

```typescript
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'ddd',

  // Module generation settings
  modules: {
    dir: 'src/modules',
    repo: 'prisma',                    // built-in: 'drizzle' | 'inmemory' | 'prisma'
    // repo: { name: 'typeorm' },      // custom ORM
    pluralize: true,                   // set false for singular module names
    schemaDir: 'prisma/',              // schema output directory
  },

  commands: [
    { name: 'db:migrate', description: 'Run migrations', steps: 'npx prisma migrate dev' },
    { name: 'db:seed', description: 'Seed database', steps: 'npx prisma db seed' },
  ],
})
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/guide/generators)

## License

MIT
