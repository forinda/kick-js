# Custom Commands

KickJS lets you extend the CLI with project-specific commands defined in `kick.config.ts`. These appear alongside built-in commands in `kick --help`.

## Configuration

Create a `kick.config.ts` (or `.js`, `.mjs`, `.json`) in your project root:

```ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  commands: [
    {
      name: 'db:migrate',
      description: 'Run database migrations',
      steps: 'npx drizzle-kit migrate',
    },
    {
      name: 'db:seed',
      description: 'Run seed files',
      steps: 'npx tsx src/db/seed.ts',
    },
    {
      name: 'proto:gen',
      description: 'Generate TypeScript from protobuf definitions',
      steps: [
        'npx buf generate',
        'echo "Protobuf types generated"',
      ],
    },
  ],
})
```

## defineConfig()

The `defineConfig` helper provides type safety for your configuration:

```ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  modules: {
    dir: 'src/modules',
    repo: 'drizzle',
    schemaDir: 'src/db/schema',
  },
  style: {
    semicolons: false,
    quotes: 'single',
    trailingComma: 'all',
    indent: 2,
  },
  commands: [ /* ... */ ],
})
```

## Command Definition

Each command in the `commands` array has this shape:

```ts
interface KickCommandDefinition {
  name: string           // Command name (e.g. 'db:migrate')
  description: string    // Shown in --help
  steps: string | string[]  // Shell command(s) to execute
  aliases?: string[]     // Optional aliases (e.g. ['migrate'])
}
```

### Single Step

```ts
{
  name: 'db:push',
  description: 'Push schema directly (dev only)',
  steps: 'npx drizzle-kit push',
}
```

### Multiple Steps

When `steps` is an array, commands run sequentially. If any step fails, execution stops:

```ts
{
  name: 'db:reset',
  description: 'Drop and recreate the database',
  steps: [
    'npx drizzle-kit drop',
    'npx drizzle-kit migrate',
    'npx tsx src/db/seed.ts',
  ],
}
```

### Aliases

```ts
{
  name: 'db:migrate',
  description: 'Run database migrations',
  steps: 'npx drizzle-kit migrate',
  aliases: ['migrate'],
}
```

Now both `kick db:migrate` and `kick migrate` work.

### Passing Arguments

Custom commands accept trailing arguments. Any extra arguments are appended to the shell command:

```bash
kick db:migrate --verbose
# Runs: npx drizzle-kit migrate --verbose
```

## Full Example

A production `kick.config.ts` with Drizzle ORM commands:

```ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  modules: {
    dir: 'src/modules',
    repo: 'drizzle',
  },
  commands: [
    {
      name: 'db:generate',
      description: 'Generate Drizzle migrations from schema',
      steps: 'npx drizzle-kit generate',
    },
    {
      name: 'db:migrate',
      description: 'Run database migrations',
      steps: 'npx drizzle-kit migrate',
    },
    {
      name: 'db:push',
      description: 'Push schema directly (dev only)',
      steps: 'npx drizzle-kit push',
    },
    {
      name: 'db:studio',
      description: 'Open Drizzle Studio GUI',
      steps: 'npx drizzle-kit studio',
    },
    {
      name: 'db:seed',
      description: 'Run seed files',
      steps: 'npx tsx src/db/seed.ts',
    },
  ],
})
```

## Copying Static Assets (copyDirs)

When you run `kick build`, Vite bundles your TypeScript into `dist/index.js`. But static assets like EJS templates, HTML files, or public CSS/JS need to be copied alongside the bundle for runtime access.

The `copyDirs` config handles this automatically after `vite build` completes:

```ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  copyDirs: [
    'views',                                    // views/ → dist/views/
    'public',                                   // public/ → dist/public/
    { src: 'templates', dest: 'dist/email' },   // templates/ → dist/email/
  ],
})
```

Each entry can be:
- A **string** — copies `<name>/` to `dist/<name>/`
- An **object** with `src` and optional `dest` — copies `src` to the specified destination

### Build output

```bash
kick build

  Building for production...

  vite v8.0.2 building ssr environment for production...
  ✓ 83 modules transformed.
  dist/index.js  429.46 kB

  Copying directories to dist...
    ✓ views → dist/views
    ✓ public → dist/public

  Build complete.
```

### When to use

- **EJS/Pug/Handlebars templates** served by the `ViewAdapter`
- **Public assets** (CSS, JS, images) served via `express.static()`
- **Email templates** loaded at runtime by the mailer
- **Migration files** or seed scripts that need to ship with the build


## Config File Resolution

The CLI searches for configuration in this order:

1. `kick.config.ts`
2. `kick.config.js`
3. `kick.config.mjs`
4. `kick.config.json`

The first file found is loaded. TypeScript and ESM files are imported dynamically. JSON files are parsed directly. If no config file is found, custom commands are simply not registered.
