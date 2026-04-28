# M2 Release Notes — v5.1.0

**Theme:** the schema is the source of truth.

M2 is the milestone where `@forinda/kickjs-db` stops asking adopters to maintain a parallel `interface DB` alongside their schema. The phantom-typed column builders, `SchemaToKysely<S>` distributive type, and `KickDbRegister` module augmentation make `KickDbClient` widen to the right row shape everywhere — controllers, repositories, modules — automatically. The CLI's typegen plugin contract emits the augmentation; adopters never write it by hand.

The same milestone added the day-to-day extension surfaces (`customType`, `pgEnum`, `$extends({ model })`, `slowQueryThresholdMs`), the kick CLI plugin contract that built-ins dogfood, and a refreshed DevTools panel with theme support, pagination, and per-group collapse.

## Adopter-facing wins

### Schema → types, no manual sync

```ts
// db/schema/users.ts
export const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
  isActive: boolean().notNull().default('true'),
  createdAt: timestamp().notNull().defaultNow(),
})

// db/client.ts
export const dbClient = createDbClient({ schema, dialect, events: true })
//                  ^^^^^^^^ KickDbClient<SchemaToKysely<typeof schema>>

// repository
@Service()
export class UsersRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}
  //                                                    ^^^^^^^^^^^^
  // bare KickDbClient widens via the auto-generated `KickDbRegister`
  // augmentation — no hand-written register.ts, no `as Db` cast.

  list() {
    return this.db.selectFrom('users').selectAll().execute()
    //                       ^^^^^^^ typechecked against the schema
  }
}
```

`kick typegen` (also auto-runs on `kick dev`) emits the augmentation into `.kickjs/types/kick__db.d.ts`. Disable per-plugin via `typegen.disable: ['kick/db']` if you prefer hand-written augmentations.

### Adopter-defined column types

```ts
const encrypted = customType<EncryptedString>({
  dataType: () => 'text',
  toDriver: (s) => encryptSync(s),
  fromDriver: (raw) => decryptSync(String(raw)) as EncryptedString,
})

const secrets = table('secrets', {
  id: serial().primaryKey(),
  value: encrypted().notNull(),
})
```

`fromDriver` fires automatically on select via the kick/db Kysely plugin. `toDriver` is stored on the builder; auto-application on insert lands in a follow-up. See [DB Extensions](../guide/db-extensions.md) for the full pattern.

### PostgreSQL enums

```ts
export const taskStatus = pgEnum(
  'task_status',
  'todo', 'in_progress', 'done',
)

export const tasks = table('tasks', {
  status: taskStatus().notNull().default('todo'),
})
```

Phantom narrows the column to `'todo' | 'in_progress' | 'done'`; the snapshot/diff/emit pipeline produces `CREATE TYPE … AS ENUM (…)` ahead of every dependent table. Adding values mid-list emits `ALTER TYPE … ADD VALUE … BEFORE …` so existing rows round-trip.

### Per-table method extensions

```ts
const dbX = db.$extends({
  model: {
    users: {
      async findByEmail(this: typeof dbX, email: string) {
        return this.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
      },
    },
  },
})

await dbX.users.findByEmail('a@b.com')
```

### Slow-query detection + lifecycle hooks

```ts
const db = createDbClient({
  schema,
  dialect,
  events: true,
  slowQueryThresholdMs: 100,
})

db.on('slowQuery', ({ sql, durationMs, thresholdMs }) => {
  log.warn({ sql, durationMs, thresholdMs }, 'slow query detected')
})
db.on('queryError', ({ sql, error }) => {
  log.error({ sql, err: error }, 'query failed')
})
```

Wired through Kysely's `log` callback; zero-overhead path when events are off (no callback registered).

### Self-referencing tables

```ts
import { type ColumnRef } from '@forinda/kickjs-db'

export const categories = table('categories', {
  id: uuid().primaryKey().defaultRandom(),
  parentId: uuid().references((): ColumnRef => categories.id, { onDelete: 'set_null' }),
})
```

Lazy FK thunk + the `ColumnRef` annotation breaks the TS7022 inference cycle on the outer const.

## CLI plugin contract

Every built-in `kick` command (init / generate / run / typegen / db / …) ships as a `KickCliPlugin` internally. Adopters extend the same surface from `kick.config.ts`:

```ts
export default defineConfig({
  plugins: [drizzlePlugin({ schemaPath: 'src/db/schema' })],
})
```

Plugins contribute `commands`, `register` (programmatic commander chains), `typegens`, and `generators`. The `kick/db` typegen plugin uses this contract to emit the `KickDbRegister` augmentation. `kick typegen --list` shows registered ids; `typegen.disable` opts a builtin out cleanly. `kick typegen --check` is the CI gate.

## DevTools refresh

- **Light + dark themes** — `<html data-theme>` flips palettes via CSS variable overrides. Toggle in the header (sun/moon icon) cycles `system → light → dark`; persists in `localStorage`.
- **Brand palette** — gold (primary) + purple (secondary) tokens that deepen on light backgrounds for AA-clean contrast.
- **Card polish** — soft shadow + hover lift, larger metric values, tighter rhythm.
- **Pagination** — every long list (Container, Routes, Queues, Graph nodes, Topology DI tokens + Contributors) paginates at 5/page with 5-step size selector.
- **Collapsible groups** — Graph tab groups (controllers / services / etc.) collapse with persistence per-group.
- **Reactive Container snapshots** — Container now emits `'resolved'` events on every resolve path; devtools subscribe via SSE so the panel reflects state changes without polling.
- **`@Autowired` dependencies surface** — `Container.extractDependencies()` was missing the property-injection branch, leaving classes that only use `@Autowired` showing empty deps. Now covered.
- **Application contributors with proper labels** — `Application.getContributors()` walks adapter / plugin / global registries with source-aware labels; topology tab shows the full set, not just adapter-attached entries.
- **DevtoolsRenderTab additive contract** — `defineDevtoolsRenderTab({ id, name, render(el, props) })` coexists with the legacy descriptor surface. Migration is per-tab; M2.D's KickEventBus completes the picture.

## Real-world workload

`examples/task-kickdb-api` is now a 17-table port of `task-prisma-api`:

- 5 PG enums (`global_role`, `workspace_role`, `task_priority`, `channel_type`, `notification_type`)
- Self-referencing FK on `tasks.parentTaskId`
- Composite-key join tables (workspace_members, channel_members, task_assignees, task_labels)
- Default JSON values inline as PG cast expressions
- Multi-file barrel — 17 per-table modules + a single `relations.ts`

`kick db generate full-port` produces an 86-change migration with `CREATE TYPE` ordered ahead of dependent tables and `DROP TYPE` ordered after dependent table drops on rollback.

## Out of scope (deferred)

The following land in a follow-up sprint, tracked as roadmap items:

- **`$extends({ result })`** — `compute()` over selected rows. Needs a Kysely `OperationNodeTransformer` that walks `SelectQueryNode` and applies the post-fetch transform.
- **`customType` `toDriver` insert path** — same plugin plumbing as result extensions.
- **`db.query.X.findMany({ with })`** — relational query compilation to a single SQL with JSON aggregation per dialect. The biggest task in the M2 plan, deferred to its own sprint where the dialect-specific design gets focused attention.
- **M2.D KickEventBus** — completes the M2.C tab migration story.
- **M2.E Vite AST strip** — Babel transform plugin to strip devtools tab code from production bundles.
- **Routes/env legacy generator carve-up** — the M2.B-T8 leftover; the kick/assets typegen carved cleanly, routes/env need their hoisted-import strategy reworked first.
- **Removed-enum-value handling** — currently a silent no-op; round-tripping requires column drops the operator must orchestrate.

## Migration notes

### From v5.0 adopter projects using kick-db

- **`Register` was renamed to `KickDbRegister`.** Hand-written augmentations:
  ```diff
  - declare module '@forinda/kickjs-db' { interface Register { db: typeof dbClient } }
  + declare module '@forinda/kickjs-db' { interface KickDbRegister { db: typeof dbClient } }
  ```
  Most adopters who follow the example app delete this file entirely once `kick typegen` runs (the kick/db plugin emits the equivalent augmentation under `.kickjs/types/`).

- **`createDbClient` infers DB from schema by default.** The previous `createDbClient<TSchema, DB = unknown>` collapsed to `KickDbClient<unknown>` unless adopters passed an explicit generic. Now `DB = SchemaToKysely<TSchema>` — the explicit generic is no longer needed:
  ```diff
  - export const dbClient = createDbClient<typeof schema, MyDb>({ schema, dialect })
  + export const dbClient = createDbClient({ schema, dialect })
  ```

- **`kick.config.ts > db.schemaPath`** with a barrel folder needs the explicit `/index.ts` suffix:
  ```diff
  -   schemaPath: 'src/db/schema',
  +   schemaPath: 'src/db/schema/index.ts',
  ```
  Required because Node's ESM loader doesn't auto-resolve directory imports under `--experimental-strip-types`.

- **`tsconfig.json` for projects using a barrel schema folder** needs `allowImportingTsExtensions: true` and `noEmit: true` so cross-file imports inside the schema folder can use explicit `.ts` extensions (Node's loader requires them).

### From v5.0 adopter projects using kickjs-cli

- **`KickConfig.plugins?: KickCliPlugin[]`** is the new extension surface. Existing `commands` field still works; plugin commands appear first, adopter `commands` overrides plugin commands of the same name.

- **`package.json > kickjs.generators` discovery is deprecated.** Plugin authors should migrate to `KickCliPlugin.generators[]` shipped via `kick.config.ts`. The legacy discovery still runs as a fallback for one minor version; remove in v5.2.

### From v5.0 adopter projects using devtools

- **Theme toggle** — `<html data-theme>` is now set at runtime. Adopters who shipped custom DevTools tabs against raw Tailwind slate utilities should migrate to the semantic tokens (`bg-app-bg`, `text-text-secondary`, `border-border`, etc.) for light-mode support. Tabs using the `.card` / `.tab` / `.empty` @apply classes flip automatically.

## Stats

- 50+ commits across packages/db, packages/cli, packages/devtools, packages/devtools-kit, packages/kickjs, examples/task-kickdb-api, and docs
- Net new: customType, pgEnum, $extends, KickCliPlugin, kickDbTypegen, kickAssetsTypegen, lifecycle hooks, light/dark theme, pagination, collapsible groups, full-port example
- Test counts (final): kickjs 317, db 199, cli 200, devtools 66
