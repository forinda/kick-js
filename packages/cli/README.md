# @forinda/kickjs-cli

CLI for KickJS — project scaffolding, DDD module generators, dev/build/start commands.

## Install

```bash
pnpm add -D @forinda/kickjs-cli

# or scaffold a fresh project
npx @forinda/kickjs-cli new my-api
```

## Commands

```bash
kick new <name>           # Scaffold a new KickJS project
kick dev                  # Start dev server with Vite HMR
kick build                # Production build via Vite
kick start                # Run production build

kick g module <name>      # Generate a full DDD module
kick g scaffold <name> <fields…>  # CRUD module from field definitions
kick g controller|service|middleware|guard|adapter|dto <name>

kick rm module <name>     # Remove a module
kick add <pkg>            # Install a KickJS package + peers
kick add --list           # Show all available packages

kick mcp start            # Run app as an MCP stdio server
kick typegen              # Refresh KickRoutes / KickEnv type maps
```

`kick new` is interactive (template, package manager, ORM, package multi-select, git init, install) — every prompt has a flag for CI: `--template rest|graphql|ddd|cqrs|minimal`, `--pm pnpm|npm|yarn`, `--repo prisma|drizzle|inmemory|custom`, `--no-git`, `--no-install`, `--force`.

## Documentation

[forinda.github.io/kick-js/guide/cli-commands](https://forinda.github.io/kick-js/guide/cli-commands) — every command + flag, custom commands via `kick.config.ts`, generator architecture.

## License

MIT
