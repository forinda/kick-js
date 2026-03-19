# @forinda/kickjs-cli

CLI for KickJS — project scaffolding, DDD module generation, dev/build/start commands.

## Install

```bash
pnpm add -D @forinda/kickjs-cli
```

## Commands

```bash
kick new <name>           # Scaffold a new KickJS project
kick dev                  # Start dev server with Vite HMR
kick build                # Production build via Vite
kick start                # Run production build
kick info                 # Print system and framework info

kick g module <name>      # Generate full DDD module
kick g controller <name>  # Generate controller
kick g service <name>     # Generate service
kick g middleware <name>  # Generate middleware
kick g guard <name>       # Generate auth guard
kick g adapter <name>     # Generate lifecycle adapter
kick g dto <name>         # Generate DTO with Zod schema
```

## Generator Flags

```bash
kick g module users --no-entity   # Skip entity/value objects
kick g module users --minimal     # Only index.ts + controller
kick g module users --dry-run     # Preview without writing
```

## Custom Commands

Extend the CLI via `kick.config.ts`:

```typescript
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  commands: [
    { name: 'db:migrate', description: 'Run migrations', steps: 'npx drizzle-kit migrate' },
    { name: 'db:seed', description: 'Seed database', steps: 'npx tsx src/db/seed.ts' },
  ],
})
```

## Documentation

[Full documentation](https://github.com/forinda/kick-js)

## License

MIT
