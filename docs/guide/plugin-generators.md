# Plugin Generators

KickJS plugins can ship their own `kick g <name>` scaffolders the same way the framework's built-in generators do. Adopters install the plugin, run `kick g --list`, and the plugin's generators show up alongside `module`, `service`, `controller`, etc.

::: tip Generators ride on the CLI plugin contract
This page covers generator authoring specifically. For the full plugin shape — `commands`, `register`, `typegens`, `generators`, conflict semantics, and how built-ins use the same contract — see [CLI Plugins](./cli-plugins.md).
:::

## Author a generator

Build the generator with `defineGenerator`, then expose it via the `generators` field of a `KickCliPlugin`:

```ts
// src/index.ts (your plugin entry)
import { defineCliPlugin, defineGenerator } from '@forinda/kickjs-cli'

const actionGen = defineGenerator({
  name: 'action',
  description: 'Generate a service action + handler',
  args: [{ name: 'name', required: true }],
  files: (ctx) => [
    {
      path: `${ctx.modulesDir}/${ctx.kebab}/create-${ctx.kebab}.action.ts`,
      content: `// Action for ${ctx.pascal}\nexport class Create${ctx.pascal}Action {}\n`,
    },
    {
      path: `${ctx.modulesDir}/${ctx.kebab}/create-${ctx.kebab}.handler.ts`,
      content: `// Handler for ${ctx.pascal}\nexport class Create${ctx.pascal}Handler {}\n`,
    },
  ],
})

export const actionPlugin = defineCliPlugin({
  name: 'my-action-plugin',
  generators: [actionGen],
})
```

Adopters wire the plugin in `kick.config.ts`:

```ts
import { defineConfig } from '@forinda/kickjs-cli'
import { actionPlugin } from '@my-org/kickjs-cli-actions'

export default defineConfig({
  plugins: [actionPlugin],
})
```

That's it — `kick g action Order` dispatches against the registered spec.

::: warning Legacy `package.json > kickjs.generators` discovery
The previous shape pointed `package.json` at a compiled manifest:

```json
{
  "kickjs": { "generators": "./dist/generators.js" }
}
```

That discovery path still works as a deprecated fallback for one minor version so existing plugins keep functioning. New plugins should ship generators through `KickCliPlugin.generators[]` so adopters control loading via `kick.config.ts > plugins[]` and benefit from the conflict-detection pipeline.
:::

## The API

### `GeneratorSpec`

What `defineGenerator` takes, and the whole contract:

```ts
interface GeneratorSpec {
  /** Dispatch name — `kick g <name>` matches this exactly. */
  name: string
  /** Shown in `kick g --list` and `--help`. */
  description: string
  /** Argument descriptors. Informational: surfaced in help, not enforced. */
  args?: readonly GeneratorArg[]
  /** Flag descriptors. Informational: surfaced in help, not enforced. */
  flags?: readonly GeneratorFlag[]
  /** Build the files for one invocation. May return a Promise. */
  files(ctx: GeneratorContext): GeneratorFile[] | Promise<GeneratorFile[]>
}

interface GeneratorArg {
  name: string
  required?: boolean
  description?: string
}

interface GeneratorFlag {
  name: string
  alias?: string
  description?: string
  /** Boolean unless set. */
  takesValue?: boolean
}
```

`args` and `flags` are **descriptors, not validation**. They populate help output
and signal intent; the CLI does not reject a call that omits a `required` arg. If
your generator needs an argument, check for it in `files()` and throw with a
message that says what was missing.

### `GeneratorContext`

The `ctx` handed to `files()`, with the name variants pre-computed so no
generator reinvents case conversion:

```ts
interface GeneratorContext {
  name: string // raw input:        'UserPost'
  pascal: string //                   'UserPost'
  camel: string //                   'userPost'
  kebab: string //                   'user-post'
  snake: string //                   'user_post'

  pluralPascal?: string //                   'UserPosts'  — when pluralize is on
  pluralKebab?: string //                   'user-posts'
  pluralCamel?: string //                   'userPosts'

  modulesDir: string // from kick.config.ts, default 'src/modules'
  cwd: string // where the CLI was invoked — may be a SUBDIRECTORY
  projectRoot: string // nearest ancestor with kick.config.* or package.json

  args: string[] // extra positionals
  flags: Record<string, string | boolean> // parsed flags
}
```

::: warning `cwd` is not the project root
`GeneratorFile.path` resolves against **`ctx.cwd`**, which is wherever the
adopter happened to run the command. Someone inside `src/modules/orders/`
running `kick g action Refund` gets files under
`src/modules/orders/src/modules/…` if your generator writes
`` `${ctx.modulesDir}/…` `` and assumes the root.

Build project-relative paths from `ctx.projectRoot`:

```ts
files: (ctx) => [
  {
    path: join(ctx.projectRoot, ctx.modulesDir, ctx.kebab, `${ctx.kebab}.action.ts`),
    content: '…',
  },
]
```

Use `ctx.cwd` only when you genuinely mean "next to where they are standing".
:::

### `GeneratorFile`

```ts
interface GeneratorFile {
  /** Relative paths resolve against ctx.cwd; absolute are used as-is. */
  path: string
  /** Written verbatim, UTF-8. */
  content: string
}
```

Parent directories are created for you. `--dry-run` is handled by the CLI — if
the adopter passed it, your files are previewed rather than written, and your
generator needs no branch for it.

## Worked example: a queue job generator

`kick g job` used to ship with the CLI. It was removed because it imported
`@forinda/kickjs-queue`, which no template installs — so in most projects it
generated a file that could not compile. Queue shapes also differ enough between
projects that one built-in template was never going to fit.

Here is the same thing as a project-local generator, which you can edit to match
the queues you actually run:

```ts
// kick.config.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, defineCliPlugin, defineGenerator } from '@forinda/kickjs-cli'

const jobGenerator = defineGenerator({
  name: 'job',
  description: 'Generate a @Job queue processor with @Process handlers',
  args: [{ name: 'name', required: true }],
  flags: [{ name: 'queue', alias: 'q', takesValue: true, description: 'Queue name' }],
  files: (ctx) => {
    // `required: true` on an arg populates help output; it does not make the
    // CLI reject a call. Check what you need, and say what is missing.
    if (!ctx.name) throw new Error('kick g job <name> — a job name is required')

    // Do not emit an import the project may not have. This is the exact defect
    // that got the built-in `job` generator removed: it imported
    // @forinda/kickjs-queue whether or not the project depended on it, and the
    // generated file could not compile.
    const pkg = JSON.parse(readFileSync(join(ctx.projectRoot, 'package.json'), 'utf-8'))
    if (!pkg.dependencies?.['@forinda/kickjs-queue']) {
      throw new Error('kick g job needs @forinda/kickjs-queue.\n  Install it first: kick add queue')
    }

    const queue = typeof ctx.flags.queue === 'string' ? ctx.flags.queue : `${ctx.kebab}-queue`

    return [
      {
        path: join(ctx.projectRoot, 'src/jobs', `${ctx.kebab}.job.ts`),
        content: `import { Inject } from '@forinda/kickjs'
import { Job, Process, QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue'

@Job('${queue}')
export class ${ctx.pascal}Job {
  constructor(@Inject(QUEUE_MANAGER) private readonly queue: QueueService) {}

  @Process()
  async handle(payload: unknown): Promise<void> {
    // ...
  }
}
`,
      },
    ]
  },
})

export default defineConfig({
  plugins: [defineCliPlugin({ name: 'local-generators', generators: [jobGenerator] })],
})
```

`kick g job email --queue emails` then writes `src/jobs/email.job.ts`, and
`kick g --list` shows it beside the built-ins.

Because it lives in your repo, it can also do what a built-in never could: read
your queue registry, default the queue name from a constant, or emit the
matching test file alongside.

## Testing a generator

`files()` is a pure function of its context. Call it directly — no CLI, no
filesystem:

```ts
import { describe, expect, it } from 'vitest'
import { jobGenerator } from '../kick.config'

const ctx = {
  name: 'Email',
  pascal: 'Email',
  camel: 'email',
  kebab: 'email',
  snake: 'email',
  modulesDir: 'src/modules',
  cwd: '/repo',
  projectRoot: '/repo',
  args: [],
  flags: { queue: 'emails' },
}

describe('job generator', () => {
  it('writes one job file under the project root', async () => {
    const files = await jobGenerator.files(ctx)

    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('/repo/src/jobs/email.job.ts')
  })

  it('uses the queue flag, and defaults from the name without it', async () => {
    expect((await jobGenerator.files(ctx))[0].content).toContain("@Job('emails')")

    const noFlag = { ...ctx, flags: {} }
    expect((await jobGenerator.files(noFlag))[0].content).toContain("@Job('email-queue')")
  })

  it('imports nothing the project does not depend on', async () => {
    // The reason the built-in was removed: it imported @forinda/kickjs-queue
    // whether or not the project had it. Yours can assert its own contract.
    const content = (await jobGenerator.files(ctx))[0].content
    expect(content).toContain('@forinda/kickjs-queue')
  })
})
```

## Discovery + dispatch

`kick g --list` reads `kick.config.ts > plugins[]`, walks each plugin's
`generators` field, and merges those entries with the built-ins.
`kick g <name> <itemName>` dispatches by exact-name match. If nothing claims
that name, the CLI falls through to the bare-module shortcut
(`kick g user` = `kick g module user`).

Conflict handling rides on the [CLI plugin contract](./cli-plugins.md#conflict-handling):
two plugins registering the same generator `name` fails fast at startup, naming
both plugins. Built-ins are registered first and win ties — so pick a name they
do not use, or you will silently never be called.

For adopters on the legacy `package.json > kickjs.generators` discovery path, the
CLI still walks direct dependencies and surfaces failed manifests under "Failed
to load" in `kick g --list`, for one more minor version.

## Authoring tips

- **Keep `defineGenerator` calls pure.** No disk reads, no network, no heavy
  imports at module top level — the CLI dynamic-imports your plugin on every
  `kick g` invocation, including `--list`.
- **Build paths from `ctx.projectRoot`.** See the warning above; `ctx.cwd` is
  where the adopter stood, not where the project is.
- **Use `ctx.modulesDir`, never a hardcoded `'src/modules'`.** Adopters override
  it in `kick.config.ts > modules.dir`.
- **Do not emit imports the project may not have.** A generated file that cannot
  compile is worse than no generator: it lands in the adopter's repo, in a file
  they did not write. If your template needs an optional package, check
  `package.json` and refuse with the install command rather than writing it.
- **Prefer template literals over template engines.** The content is a string;
  reach for handlebars only when conditionals get genuinely unreadable.
- **Return every file from one call.** `files()` returning the complete set lets
  `--dry-run` preview the whole change and keeps writes atomic in intent.

## What stays built in, and what does not

The line is ownership, not size.

**Generators for first-class KickJS interfaces stay.** `plugin`, `middleware`,
`guard`, `contributor`, `adapter`, `dto`, `controller`, `service`, `module` all
scaffold a shape the framework itself defines — an `AppAdapter` with the right
lifecycle hooks, a `KickPlugin` with the right registration fields, a context
contributor with its `ContextMeta` stub, a DTO wired to the configured schema
library. Those interfaces are easy to get subtly wrong by hand, and getting
them wrong fails at boot rather than at the keyboard. Maintaining a generator
for a shape we define is work we owe adopters.

**Generators for third-party shapes do not.** `kick g job` scaffolded a queue
processor around `@forinda/kickjs-queue` — a package no template installs, so
in most projects it wrote a file that could not compile. Worse, its shape
belonged to whichever queue you actually run, which is not something the
framework can know or should track. It was removed.

That is the test for anything proposed as a built-in: **is the interface ours?**
If it is, a generator prevents a whole class of mistake. If it is not, the
generator becomes a promise to track someone else's API, and the adopter is
better served by a `defineGenerator` shaped to the library they chose. The
worked example above is exactly that — `kick g job`, rebuilt as twenty lines
you own.

## Why extend rather than wait

Even inside the first-class set, a built-in only knows the shape — not your
conventions. If `kick g service` almost fits, copy its output into a
`defineGenerator` and change the parts you always change. Yours can read your
own registry, follow your folder layout, emit the matching test, and import
only what your project actually depends on.
