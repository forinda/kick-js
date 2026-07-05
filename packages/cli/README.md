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
kick add upload           # Install the multipart driver for your runtime
kick add --list           # Show all available packages

kick doctor               # Pre-flight checks (engine peers, upload driver, env wiring)
kick mcp start            # Run app as an MCP stdio server
kick typegen              # Refresh KickRoutes / KickEnv / KickRuntimeRegister type maps
```

`kick new` is interactive (template, runtime, package manager, repository, package multi-select, git init, install) — every prompt has a flag for CI: `--template rest|minimal`, `--runtime express|fastify|h3`, `--pm pnpm|npm|yarn|bun`, `--repo inmemory|<db-name>` (e.g. `postgres`), `--packages auth,swagger,…`, `--no-git`, `--no-install`, `--force`, `-y/--yes`.

## HTTP runtimes

KickJS runs on **Express** (default), **Fastify**, or **h3** — pick the engine at scaffold time with `kick new --runtime`, and the CLI installs the right engine peers and writes `runtime` into `kick.config.ts`. That field then drives the dep-aware commands:

```bash
kick new my-api --runtime fastify   # scaffolds fastify + @fastify/middie, runtime: 'fastify'
kick add upload                     # → @fastify/multipart (express → multer, h3 → built-in)
kick doctor                         # verifies the engine peers + upload driver are present
kick typegen                        # emits KickRuntimeRegister so ctx.app / getRuntimeApp() are typed to the engine
```

## Documentation

[kickjs.app/guide/cli-commands](https://kickjs.app/guide/cli-commands) — every command + flag, custom commands via `kick.config.ts`, generator architecture.

## License

MIT
