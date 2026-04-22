---
title: 'Surviving Vite HMR in KickJS Decorator-Heavy Backends'
description: 'What happens when Vite HMR meets TypeScript decorators and DI containers — class identity problems, Mongoose model crashes, and practical solutions from building Vibed.'
tags: ['kickjs', 'nodejs', 'typescript', 'hmr', 'vite']
canonical_url: null
published: false
---

# Surviving HMR in Decorator-Heavy Backends

Hot Module Replacement was supposed to make backend development faster. Edit a file, save, see the change instantly. No cold restart, no waiting for database reconnection, no re-seeding test data. And for simple Express apps, it delivers on that promise.

But when your backend uses TypeScript decorators for controllers, services, and repositories -- when you have a DI container managing 50+ bindings -- when Mongoose models are compiled from schemas at import time -- HMR becomes a minefield. Every file save can break your DI graph, crash Mongoose, or silently disconnect your queue processors.

I spent weeks learning these lessons while building Vibed, a Jira-like backend using KickJS (a decorator-driven framework on Express 5 + Vite). Here is everything I know about making HMR and decorators coexist.

## What HMR Actually Does to Your Backend

When you run `kick dev` (or any Vite-based dev server), Vite watches your source files. When you save a change, it re-evaluates the changed module and any modules that import it. For the backend, this means:

1. The changed file is re-executed. All top-level code runs again.
2. Decorator functions execute again on the new class objects.
3. `Container.reset()` is called to clear all DI bindings.
4. `app.rebuild()` re-mounts routes and re-initializes adapters.

Steps 1 and 2 sound harmless. Steps 3 and 4 are where things break.

## Problem 1: Class Identity

This is the fundamental issue that causes most HMR pain in decorator-based backends.

When Vite re-evaluates a module, JavaScript creates **new class objects**. Consider this controller:

```typescript
// src/modules/tasks/presentation/tasks.controller.ts
@ApiTags('Tasks')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class TasksController {
  @Autowired() private createTaskUseCase!: CreateTaskUseCase
  @Autowired() private taskRepo!: MongoTaskRepository

  @Post('/projects/:projectId/tasks', {
    params: z.object({ projectId: z.string() }),
    body: createTaskSchema,
  })
  async create(ctx: RequestContext) {
    const user = ctx.get('user')
    const result = await this.createTaskUseCase.execute(ctx.params.projectId, user.id, ctx.body)
    ctx.created(successResponse(result, 'Task created'))
  }
}
```

On first load, JavaScript creates a `TasksController` class object. The DI container registers it. `@Autowired()` stores metadata referencing `CreateTaskUseCase` and `MongoTaskRepository` as class objects.

On HMR reload, JavaScript creates a **new** `TasksController` class object. It has the same name, same methods, same decorators. But `NewTasksController !== OldTasksController`. They are different objects in memory.

The DI container had a binding for `OldTasksController`. When `buildRoutes` tries to resolve `NewTasksController`, it finds nothing. The `@Autowired()` references point to `OldCreateTaskUseCase` and `OldMongoTaskRepository`, which also no longer exist in the container.

This cascading identity mismatch is why a single file save can break your entire DI graph.

## Problem 2: Mongoose Model Overwrite

Mongoose compiles schemas into models, and it keeps a global registry of compiled models. If you write a schema file like this:

```typescript
// WRONG: crashes on HMR reload
const taskSchema = new Schema({ title: String, status: String })
export const TaskModel = mongoose.model('Task', taskSchema)
```

The first time this runs, Mongoose creates the `Task` model. The second time (after HMR re-evaluates the file), Mongoose throws:

```
OverwriteModelError: Cannot overwrite 'Task' model once compiled.
```

Your dev server crashes. Every. Single. Save.

The fix is a guard pattern that checks if the model already exists:

```typescript
// src/modules/tasks/infrastructure/schemas/task.schema.ts
const taskSchema = new Schema<TaskDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    key: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    status: { type: String, default: 'todo' },
    priority: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low', 'none'],
      default: 'none',
    },
    assigneeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    labelIds: [{ type: Schema.Types.ObjectId, ref: 'Label' }],
    parentTaskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    dueDate: { type: Date },
    estimatePoints: { type: Number },
    orderIndex: { type: Number, default: 0 },
    attachmentCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
)

taskSchema.index({ projectId: 1, status: 1 })
taskSchema.index({ assigneeIds: 1 })
taskSchema.index({ dueDate: 1 })
taskSchema.index({ title: 'text', description: 'text' })

export const TaskModel =
  (mongoose.models.Task as mongoose.Model<TaskDocument>) ||
  mongoose.model<TaskDocument>('Task', taskSchema)
```

The `mongoose.models.Task || mongoose.model(...)` pattern returns the existing model on re-evaluation instead of trying to create a new one. This is required on **every schema file** in your project. Miss one, and HMR crashes.

Vibed has 12 schema files. I missed the guard on the `Activity` schema and spent 20 minutes wondering why saves to activity-related files crashed the server while everything else was fine.

## Problem 3: Queue Processors Disconnect

Queue processors in Vibed use `@Job()` and `@Service()` decorators:

```typescript
@Service()
@Job('email')
export class EmailProcessor {
  @Autowired(MAILER) private mailer!: MailerService

  @Process('send-welcome-email')
  async sendWelcome(job: BullMQJob<{ email: string; firstName: string }>) {
    logger.info(`Sending welcome email to ${job.data.email}`)
    await this.mailer.send({
      to: job.data.email,
      subject: `Welcome to Vibed, ${job.data.firstName}!`,
      html: `<h1>Welcome to Vibed!</h1>`,
    })
  }

  @Process('send-task-assigned')
  async sendTaskAssigned(
    job: BullMQJob<{ email: string; taskKey: string; taskTitle: string; assignerName: string }>,
  ) {
    await this.mailer.send({
      to: job.data.email,
      subject: `You were assigned to ${job.data.taskKey}: ${job.data.taskTitle}`,
      html: `<p>${job.data.assignerName} assigned you to <strong>${job.data.taskKey}</strong></p>`,
    })
  }
}
```

When HMR fires, `Container.reset()` wipes the binding for `EmailProcessor`. The `QueueAdapter` tries to re-resolve the processor with the new class identity and fails. You see this in the logs:

```
No binding found for: EmailProcessor
```

The good news: workers from the initial cold boot continue running. BullMQ workers are standalone processes that hold references to the processor instances created at startup. They do not go through the DI container on every job. So jobs keep processing even though the container is confused.

The bad news: if you restart the QueueAdapter (which `app.rebuild()` sometimes does), it tries to create new workers with the new class, fails to resolve them, and now nothing processes jobs until a full restart.

## The allRegistrations Map Solution (v1.2.7)

KickJS v1.2.7 introduced a mechanism to survive class identity changes across HMR cycles. The core idea is simple: maintain a map of all registrations by class **name** (string), not just class identity (object reference).

Here is the conceptual model:

```
Cold boot:
  @Service() on EmailProcessor → metadata set on ClassObjectA
  Container registers ClassObjectA → allRegistrations['EmailProcessor'] = ClassObjectA

HMR reload:
  @Service() on EmailProcessor → metadata set on ClassObjectB (new object!)
  Container.reset() → clears all bindings
  Container reads allRegistrations → finds 'EmailProcessor'
  Container re-registers ClassObjectB (from updated job registry)
  Resolution works again
```

The `_onReset` hook lets adapters participate in re-registration:

```
Container.reset()
  → clears bindings
  → calls _onReset callbacks
    → QueueAdapter reads the job registry (populated by @Job decorators on new classes)
    → QueueAdapter registers new class objects in the container
    → Workers can be recreated with fresh instances
```

This means controllers, services, and repositories survive HMR seamlessly. Queue processors survive with the adapter's help. The developer does not need to do anything special beyond the Mongoose guard pattern.

## What Still Needs a Full Restart

Not everything survives HMR, even with the allRegistrations fix. Here is the practical list from Vibed:

### Adapter configuration changes

The adapters are created once in `config/adapters.ts` and `app.rebuild()` reuses the old adapter instances. If you change the Redis connection URL, the JWT secret, or the queue concurrency setting, the old values persist until a full restart.

```typescript
// src/config/adapters.ts — changes here need a restart
const queueAdapter = QueueAdapter({
  redis: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port) || 6379,
    password: redisUrl.password || undefined,
  },
  queues: ['email', 'notifications', 'activity'],
  concurrency: 5, // Changing this? Restart.
})

export const adapters = [
  new MongooseAdapter(env.MONGODB_URI), // Changing URI? Restart.
  AuthAdapter({
    strategies: [JwtStrategy({ secret: env.JWT_SECRET })], // New secret? Restart.
    defaultPolicy: 'protected', // Changing policy? Restart.
  }),
  // ...
]
```

### New modules added to the modules array

Adding a new module to the registry requires a full restart because the old app does not re-read the modules array:

```typescript
// src/modules/index.ts — adding a new entry needs a restart
export const modules: AppModuleClass[] = [
  QueueModule,
  AuthModule,
  UsersModule,
  WorkspacesModule,
  // Adding ProjectsModule here? Restart.
]
```

Editing an **existing** module's code (controller logic, use case logic, guard logic) works fine with HMR. It is only adding or removing modules from the array that requires a restart.

### Queue processor class-level changes

Changing the queue name in `@Job('email')` or adding a new `@Process` method requires a restart. The BullMQ worker was created with the old queue binding and will not pick up structural changes. Changing the implementation inside an existing `@Process` method works fine with HMR though.

## Practical Tips for Decorator-Heavy Backends

Here is the playbook I follow after months of working with Vibed's HMR setup.

### 1. Add the Mongoose guard to every schema on creation, not as a fix later

Do not write `mongoose.model('X', schema)` and plan to add the guard when HMR breaks. You will forget, and you will waste time on a crash that has nothing to do with what you were actually editing.

Template:

```typescript
export const XModel =
  (mongoose.models.X as mongoose.Model<XDocument>) || mongoose.model<XDocument>('X', xSchema)
```

Paste this pattern the moment you create a schema file. Every time.

### 2. Know the restart boundary

Keep a mental model of what lives in "adapter space" vs "module space." Module space (controllers, services, use cases, guards, DTOs) survives HMR. Adapter space (connection strings, auth policies, queue names, adapter options) does not.

When something breaks after a save, ask: "Did I change module code or adapter config?" If it is adapter config, restart. If it is module code, it is probably a class identity bug.

### 3. Use @Autowired() for property injection instead of constructor @Inject()

`@Autowired()` resolves by class type, which survives HMR better because the framework can match by class name as a fallback. `@Inject(TOKEN)` resolves by Symbol identity, which is more precise but more fragile during HMR -- the token object might be the same (Symbols are file-scoped singletons), but the factory it points to might reference old class identities.

In controllers, always use `@Autowired()`:

```typescript
@Controller()
export class WorkspacesController {
  @Autowired() private createWorkspaceUseCase!: CreateWorkspaceUseCase
  @Autowired() private memberRepo!: MongoWorkspaceMemberRepository
  // ...
}
```

In use case constructors, `@Inject(TOKEN)` is necessary for interface-based injection. That is fine -- use cases are re-instantiated on resolve, so the constructor runs with fresh tokens.

### 4. Use `createToken<T>` and export it from the file that owns the interface

Modern KickJS uses `createToken<T>(name)` for DI tokens, not raw `Symbol()`. Two practical reasons that matter for HMR specifically:

1. **Type safety.** `container.resolve(USER_REPOSITORY)` returns `IUserRepository` instead of `any`, so a refactor that misses an injection site fails at compile time, not at runtime after HMR has reshuffled the container.
2. **Same-file ownership.** The token lives next to the interface it represents, and is re-imported by everything that needs it. There's no separate `TOKENS` object to keep in sync.

```typescript
// src/modules/users/domain/repositories/user.repository.ts
import { createToken } from '@forinda/kickjs'

export interface IUserRepository {
  findById(id: string): Promise<User | null>
}

// One typed token, owned by the same file as the interface.
export const USER_REPOSITORY = createToken<IUserRepository>('User/Repository')
```

```typescript
// Anywhere it's needed
import { USER_REPOSITORY, type IUserRepository } from '../domain/repositories/user.repository'

@Service()
class GetUserUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly repo: IUserRepository) {}
}
```

**HMR stability:** the token file is only re-evaluated when _that_ file changes. Because every other consumer imports the named export, they all get the same frozen object reference even after HMR rebuilds the use case. The `Symbol('x') !== Symbol('x')` foot-gun is gone — `createToken` returns an object identified by reference, so two import sites in different files share the same identity by construction.

If you're maintaining an older project that still uses a centralized `TOKENS` object of `Symbol()` instances, the migration is mechanical: replace each `Symbol('Foo')` with `createToken<IFoo>('Foo')` and import the token from the interface file directly. Both forms work side-by-side during the migration.

### 5. Ignore cosmetic HMR errors

After an HMR reload, you might see:

```
No binding found for: EmailProcessor
No binding found for: NotificationProcessor
```

These are cosmetic. The workers from cold boot are still running. Jobs are still processing. The error means the _new_ class object could not be resolved, but the _old_ instance is still alive in the BullMQ worker closure.

Do not chase these errors during active development. They resolve on the next full restart.

### 6. Structure modules so most edits stay within HMR-safe boundaries

The files you edit most often during development are:

- Controller methods (adding endpoints, changing response format)
- Use case logic (business rules)
- DTOs (adding/changing validation fields)
- Guards and middleware (access control rules)

All of these survive HMR. The files you rarely edit after initial setup are:

- Adapter configuration
- Module registry
- Schema definitions
- Token constants

This natural editing pattern means HMR works well for 90% of your day-to-day changes. The restarts come during initial scaffolding, when you are adding new modules and schemas. Once a module is set up, you live in HMR-safe territory.

### 7. When in doubt, restart

If something behaves strangely after an HMR reload -- a guard that was working now returns 403, a service that returns stale data, a queue that stops processing -- restart the dev server before debugging. More than once I have spent 30 minutes debugging a "bug" that was just a stale HMR state.

The restart takes 3 seconds. The debugging takes 30 minutes. The math is clear.

## The Bigger Picture: HMR in Backend Development

Frontend HMR is a solved problem. Vite, webpack, Turbopack -- they all handle component hot replacement gracefully because UI components are mostly stateless renders. You swap the component, React re-renders, done.

Backend HMR is harder because backends are stateful. Database connections persist. Queue workers hold references. DI containers maintain object graphs. Auth middleware caches strategies. Every piece of long-lived state is a potential HMR landmine.

The decorator-heavy approach amplifies this because decorators create implicit registration paths. When a controller decorator says `@Middleware(authBridgeMiddleware)`, it stores a reference to a function object. When a service decorator says `@Inject(TOKENS.TASK_REPOSITORY)`, it stores a reference to a Symbol. These references form an invisible web of dependencies that HMR can partially break.

The pragmatic approach is to embrace HMR for what it is good at (rapid iteration on business logic) and accept full restarts for what it is not (structural changes). With the right patterns -- Mongoose guards, centralized tokens, `@Autowired()` for properties, and a clear mental model of what survives -- you get 90% of the HMR benefit with 10% of the pain.

That is a trade I will take every time.
