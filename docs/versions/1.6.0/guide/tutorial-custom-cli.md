---
title: "KickJS Custom CLI Commands for Seeding, Resetting, and Testing — Zero Extra Dependencies"
description: "How I replaced a mess of npm scripts with custom CLI commands in KickJS's kick.config.ts, using tsx for path alias support and keeping developer experience tight."
tags: ["kickjs", "nodejs", "typescript", "mongodb", "cli"]
canonical_url: ""
published: false
cover_image: ""
---

# Custom CLI Commands for Seeding, Resetting, and Testing — Zero Extra Dependencies

Every project accumulates scripts. First it is `npm run seed`. Then `npm run db:reset`. Then `npm run seed:staging`, `npm run test:integration`, `npm run format:check`, and before you know it, your `package.json` has 18 scripts and nobody remembers what half of them do.

For Vibed, our Jira-like task management backend built on KickJS, I moved all operational commands into the framework's `kick.config.ts` file. The result: `kick seed`, `kick db:reset`, `kick check` -- discoverable, documented, and composable. No extra CLI framework, no commander.js, no yargs. Just a config file and the `kick` binary you already have.

Here is how it works, what the seed and reset scripts look like, and why CLI-level commands beat npm scripts for developer experience.

## kick.config.ts: The Command Registry

KickJS uses a `kick.config.ts` file at the project root for framework configuration. It tells the scaffolding generator where modules live, what patterns to follow, and -- the feature I care about here -- what custom commands to register.

```typescript
// kick.config.ts
import { defineConfig } from '@forinda/kickjs-cli'

export default defineConfig({
  pattern: 'rest',
  modules: {
    dir: 'src/modules',
    repo: 'inmemory',
  },

  commands: [
    {
      name: 'seed',
      description: 'Populate database with sample data',
      steps: 'npx tsx src/db/seed.ts',
    },
    {
      name: 'db:reset',
      description: 'Drop database and reseed',
      steps: ['npx tsx src/db/reset.ts', 'npx tsx src/db/seed.ts'],
    },
    {
      name: 'test',
      description: 'Run tests with Vitest',
      steps: 'npx vitest run',
    },
    {
      name: 'format',
      description: 'Format code with Prettier',
      steps: 'npx prettier --write src/',
    },
    {
      name: 'format:check',
      description: 'Check formatting without writing',
      steps: 'npx prettier --check src/',
    },
    {
      name: 'check',
      description: 'Run typecheck + format check',
      steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
      aliases: ['verify', 'ci'],
    },
  ],
})
```

Each command has a `name`, a `description` (shown when you run `kick --help`), and `steps` which can be a single string or an array of strings. Arrays execute sequentially -- if any step fails, the chain stops. The optional `aliases` field lets you run the same command under different names.

After this config, your terminal gets:

```bash
kick seed          # Insert test data
kick db:reset      # Drop everything and reseed
kick test          # Run Vitest
kick format        # Format with Prettier
kick format:check  # Check formatting
kick check         # Typecheck + format check
kick verify        # Same as check (alias)
kick ci            # Same as check (alias)
```

All discoverable with `kick --help`.

## The Seed Script: Realistic Test Data

The seed script is the most important operational script in any backend project. Bad seed data leads to bugs that only surface with real users. Good seed data exposes edge cases during development.

Here is the Vibed seed script in full:

```typescript
// src/db/seed.ts
import 'reflect-metadata';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { UserModel }
  from '@/modules/users/infrastructure/schemas/user.schema';
import { WorkspaceModel }
  from '@/modules/workspaces/infrastructure/schemas/workspace.schema';
import { WorkspaceMemberModel }
  from '@/modules/workspaces/infrastructure/schemas/workspace-member.schema';
import { ProjectModel }
  from '@/modules/projects/infrastructure/schemas/project.schema';
import { LabelModel }
  from '@/modules/labels/infrastructure/schemas/label.schema';
import { TaskModel }
  from '@/modules/tasks/infrastructure/schemas/task.schema';
import { ChannelModel }
  from '@/modules/channels/infrastructure/schemas/channel.schema';

const MONGODB_URI = process.env.MONGODB_URI!;
if (!MONGODB_URI) {
  console.error('MONGODB_URI env variable is required');
  process.exit(1);
}

async function seed() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected. Seeding database...\n');

  // ── Users ──────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('Password123!', 10);

  const users = await UserModel.insertMany([
    {
      email: 'admin@vibed.dev', passwordHash,
      firstName: 'Admin', lastName: 'User',
      globalRole: 'superadmin',
    },
    {
      email: 'alice@vibed.dev', passwordHash,
      firstName: 'Alice', lastName: 'Johnson',
      globalRole: 'user',
    },
    {
      email: 'bob@vibed.dev', passwordHash,
      firstName: 'Bob', lastName: 'Smith',
      globalRole: 'user',
    },
    {
      email: 'carol@vibed.dev', passwordHash,
      firstName: 'Carol', lastName: 'Williams',
      globalRole: 'user',
    },
  ]);
  console.log(`Created ${users.length} users`);

  const [admin, alice, bob, carol] = users;

  // ── Workspace ──────────────────────────────────────────
  const workspace = await WorkspaceModel.create({
    name: 'Vibed HQ',
    slug: 'vibed-hq',
    description: 'Main workspace for the Vibed team',
    ownerId: admin._id,
  });
  console.log(`Created workspace: ${workspace.name}`);

  // ── Workspace Members ──────────────────────────────────
  await WorkspaceMemberModel.insertMany([
    { workspaceId: workspace._id, userId: admin._id, role: 'admin' },
    { workspaceId: workspace._id, userId: alice._id, role: 'admin' },
    { workspaceId: workspace._id, userId: bob._id, role: 'member' },
    { workspaceId: workspace._id, userId: carol._id, role: 'member' },
  ]);
  console.log('Added 4 workspace members');

  // ── Labels ─────────────────────────────────────────────
  const labels = await LabelModel.insertMany([
    { workspaceId: workspace._id, name: 'bug', color: '#ef4444' },
    { workspaceId: workspace._id, name: 'feature', color: '#3b82f6' },
    { workspaceId: workspace._id, name: 'improvement', color: '#8b5cf6' },
    { workspaceId: workspace._id, name: 'docs', color: '#10b981' },
    { workspaceId: workspace._id, name: 'urgent', color: '#f97316' },
  ]);
  console.log(`Created ${labels.length} labels`);

  const [bugLabel, featureLabel, , docsLabel, urgentLabel] = labels;

  // ── Projects ───────────────────────────────────────────
  const backend = await ProjectModel.create({
    workspaceId: workspace._id,
    name: 'Backend API', key: 'API',
    description: 'KickJS backend for Vibed',
    leadId: alice._id, taskCounter: 6,
  });

  const frontend = await ProjectModel.create({
    workspaceId: workspace._id,
    name: 'Frontend App', key: 'FE',
    description: 'React frontend for Vibed',
    leadId: bob._id, taskCounter: 4,
  });
  console.log('Created 2 projects: Backend API, Frontend App');

  // ── Tasks ──────────────────────────────────────────────
  const backendTasks = await TaskModel.insertMany([
    {
      projectId: backend._id, workspaceId: workspace._id,
      key: 'API-1', title: 'Set up JWT authentication',
      status: 'done', priority: 'critical',
      assigneeIds: [alice._id], reporterId: admin._id,
      labelIds: [featureLabel._id], orderIndex: 0,
    },
    {
      projectId: backend._id, workspaceId: workspace._id,
      key: 'API-2', title: 'Add workspace CRUD and membership',
      status: 'done', priority: 'high',
      assigneeIds: [alice._id, bob._id], reporterId: admin._id,
      labelIds: [featureLabel._id], orderIndex: 1,
    },
    {
      projectId: backend._id, workspaceId: workspace._id,
      key: 'API-3', title: 'Implement task management',
      status: 'in-progress', priority: 'high',
      assigneeIds: [alice._id], reporterId: alice._id,
      labelIds: [featureLabel._id], orderIndex: 2,
    },
    // ... more tasks
  ]);

  const frontendTasks = await TaskModel.insertMany([
    {
      projectId: frontend._id, workspaceId: workspace._id,
      key: 'FE-1', title: 'Scaffold React app with Vite',
      status: 'done', priority: 'high',
      assigneeIds: [bob._id], reporterId: bob._id,
      labelIds: [featureLabel._id], orderIndex: 0,
    },
    {
      projectId: frontend._id, workspaceId: workspace._id,
      key: 'FE-2', title: 'Build kanban board component',
      status: 'in-progress', priority: 'high',
      assigneeIds: [bob._id, carol._id], reporterId: bob._id,
      labelIds: [featureLabel._id, urgentLabel._id], orderIndex: 1,
    },
    // ... more tasks
  ]);

  console.log(`Created ${backendTasks.length + frontendTasks.length} tasks`);

  // ── Channels ───────────────────────────────────────────
  await ChannelModel.insertMany([
    {
      workspaceId: workspace._id, name: 'general',
      description: 'General discussion', type: 'public',
      memberIds: [admin._id, alice._id, bob._id, carol._id],
      createdById: admin._id,
    },
    {
      workspaceId: workspace._id, projectId: backend._id,
      name: 'backend-dev', description: 'Backend development chat',
      type: 'public', memberIds: [alice._id, bob._id, carol._id],
      createdById: alice._id,
    },
    {
      workspaceId: workspace._id, projectId: frontend._id,
      name: 'frontend-dev', description: 'Frontend development chat',
      type: 'public', memberIds: [bob._id, carol._id],
      createdById: bob._id,
    },
  ]);
  console.log('Created 3 channels');

  // ── Summary ────────────────────────────────────────────
  console.log('\n--- Seed complete ---');
  console.log(`Users:      ${users.length}`);
  console.log(`Workspace:  1 (${workspace.name})`);
  console.log(`Projects:   2`);
  console.log(`Tasks:      ${backendTasks.length + frontendTasks.length}`);
  console.log(`Labels:     ${labels.length}`);
  console.log(`Channels:   3`);
  console.log('\nLogin credentials (all users): Password123!');
  console.log('Admin: admin@vibed.dev');
  console.log('Users: alice@vibed.dev, bob@vibed.dev, carol@vibed.dev');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

A few design decisions worth explaining.

### A shared password for all seed users

Every seed user gets `Password123!`. This is intentional for local development. When I (or a new team member) run `kick seed` and want to test the login flow, the password is right there in the console output. No need to look anything up.

### Realistic relationships, not random data

The seed creates a proper hierarchy: users belong to a workspace, workspace has projects, projects have tasks with assignees, tasks have labels. This is not random UUIDs thrown into collections. It is a coherent dataset that exercises foreign key relationships, permission checks, and query filters.

For example, `API-3` ("Implement task management") is assigned to Alice and has status `in-progress`. When I test the kanban board endpoint, I see a card in the right column. When I test the "my tasks" filter, Alice's tasks show up. When I test overdue reminders, `FE-4` has a due date 3 days from now that will eventually trigger.

### The order matters

Users are created first because workspaces need owner IDs. Workspaces before members. Labels before tasks (tasks reference label IDs). This sequential dependency is why `insertMany` is used per collection rather than some parallel bulk insert.

## The Reset Script: Drop and Rebuild

Sometimes seed data gets corrupted during development. Maybe I manually deleted a user but left orphaned workspace members. Maybe a schema migration changed a field name. The reset script gives me a clean slate:

```typescript
// src/db/reset.ts
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI!;
if (!MONGODB_URI) {
  console.error('MONGODB_URI env variable is required');
  process.exit(1);
}

async function reset() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);

  const db = mongoose.connection.db!;
  const collections = await db.listCollections().toArray();

  for (const col of collections) {
    await db.dropCollection(col.name);
    console.log(`Dropped: ${col.name}`);
  }

  console.log(
    `\nReset complete — dropped ${collections.length} collections`
  );
  await mongoose.disconnect();
}

reset().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
```

It drops every collection in the database, then disconnects. It does not drop the database itself because that would require elevated permissions on some MongoDB hosting providers.

The `kick db:reset` command chains this with the seed:

```typescript
{
  name: 'db:reset',
  description: 'Drop database and reseed',
  steps: ['npx tsx src/db/reset.ts', 'npx tsx src/db/seed.ts'],
},
```

Run `kick db:reset` and 10 seconds later you have a fresh database with all the test data. This is the command I run most often during development -- probably 5-10 times a day.

## Using tsx for Path Aliases

Notice that the seed script imports from `@/modules/users/infrastructure/schemas/user.schema`. That `@/` prefix is a path alias configured in `tsconfig.json` that maps to `src/`. Standard `node` does not resolve these aliases.

The solution is `tsx`, which runs TypeScript directly with ESM support. For path alias resolution, pair it with `tsconfig-paths`:

```bash
npx tsx src/db/seed.ts
```

This runs the TypeScript file directly with ESM module resolution and access to environment variables from `.env`. No compilation step, no intermediate JavaScript files.

For `@/` alias support, add `tsconfig-paths`:

```bash
npx tsx --import tsconfig-paths/register src/db/seed.ts
```

## The Check Command: Pre-Push Validation

The `check` command runs typecheck and format check in sequence:

```typescript
{
  name: 'check',
  description: 'Run typecheck + format check',
  steps: ['npx tsc --noEmit', 'npx prettier --check src/'],
  aliases: ['verify', 'ci'],
},
```

I run this before every push. The aliases matter: `kick ci` is what our CI pipeline runs, and `kick verify` is what I tell new contributors to run before opening a PR. Same command, different mental models.

If `tsc --noEmit` finds type errors, the chain stops and `prettier --check` never runs. This is intentional -- there is no point checking formatting if the code does not compile.

## Why CLI-Level Commands Beat npm Scripts

I have used npm scripts in every Node.js project for the last decade. They work. But kick commands are better for operational scripts, and here is why.

### Discoverability

Run `kick --help` and you see every custom command with its description. Run `npm run` and you see a wall of script names with no context:

```
Lifecycle scripts included in vibed@1.2.7:
  test
    vitest run

available via `npm run-script`:
  dev
    kick dev
  build
    kick build
  ...
```

No descriptions. No grouping. No way to tell which scripts are for developers vs. CI vs. operations.

### Composition

npm scripts compose awkwardly. You need `&&` for sequencing, `concurrently` for parallelism, and `cross-env` for environment variables. kick commands support arrays for sequential steps natively:

```typescript
steps: ['npx tsx src/db/reset.ts', 'npx tsx src/db/seed.ts'],
```

No shell operator gymnastics. If a step fails, it stops.

### Coexistence with npm scripts

kick commands do not replace npm scripts. The standard lifecycle scripts (`dev`, `build`, `start`, `test`) still live in `package.json` because that is where CI tools, IDEs, and other developers expect them. But operational commands (`seed`, `db:reset`, `check`) work better in kick.config.ts.

In Vibed, the package.json scripts are thin wrappers:

```json
{
  "scripts": {
    "dev": "kick dev",
    "build": "kick build",
    "start": "kick start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write src/"
  }
}
```

Six scripts, all obvious. The operational commands live in `kick.config.ts` where they have descriptions and can compose steps.

### No extra dependencies

I have seen projects pull in `commander`, `yargs`, `inquirer`, `chalk`, and `ora` just to build a CLI for seed scripts. That is five dependencies (and their transitive dependencies) for something that should be configuration.

KickJS's `defineConfig` reads the command list and registers them with the `kick` binary. No runtime overhead, no additional packages, no CLI framework to learn. If you already use `kick dev` and `kick build`, custom commands are free.

## Practical Tips for Seed Scripts

After writing seed scripts for a dozen projects, here are the patterns that consistently work:

1. **Print credentials at the end.** Developers will forget the test passwords. Print them every time the seed runs.

2. **Make seeds idempotent or make reset easy.** Either use `upsert` so running seed twice does not fail on duplicate keys, or provide a reset command that clears everything first. I chose the reset approach because it is simpler and guarantees clean state.

3. **Use real-looking data.** "Test User 1" is useless for testing search, sorting, or display truncation. "Alice Johnson" tells you something when it shows up in a dropdown.

4. **Create enough data to exercise pagination.** If your API paginates at 20 items per page, seed at least 25 of something. Vibed seeds 10 tasks across 2 projects, which is enough for basic development but should grow as the API matures.

5. **Seed all entity types.** If your app has users, workspaces, projects, tasks, labels, and channels, the seed should create all of them with proper relationships. Skipping channels means you cannot test the messaging endpoints without manual setup.

6. **Log counts, not data.** Print `Created 4 users` not the full user objects. Keep the output scannable.

## Putting It All Together

Here is my typical development workflow with these commands:

```bash
# First day on the project
kick seed

# Messed up the data
kick db:reset

# Before pushing
kick check

# Before opening a PR
kick test && kick check

# After pulling changes that modified schemas
kick db:reset
```

Five commands that cover the full development lifecycle. All discoverable with `--help`. All defined in a single config file. No dependency bloat, no shell script spaghetti, no undocumented tribal knowledge.

The key insight is that developer experience tooling does not need to be complex. A config file with a `commands` array, a script runner that supports path aliases, and sensible defaults cover 90% of what teams need. The remaining 10% -- interactive prompts, environment selection, dry-run modes -- can wait until you actually need them. Start simple, add complexity only when the pain demands it.

Vibed's entire operational CLI is 41 lines of configuration. That is the kind of leverage I want from my tools.
