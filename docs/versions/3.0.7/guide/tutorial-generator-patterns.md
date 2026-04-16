# KickJS Module Generator: 4 Architecture Patterns for Every Backend Need

**Tags:** kickjs, mongodb, typescript, nodejs, architecture

---

One of the things I appreciate most about working with a framework is when it meets me where I am. Not every feature I build needs the same level of ceremony. A health check endpoint does not need domain-driven design. A real-time collaboration feature probably does. The KickJS module generator understands this distinction, and it changed how I think about scaffolding backend code.

The command is simple:

```bash
kick g module <name> --pattern <pattern>
```

That `--pattern` flag is where the magic lives. KickJS ships four architecture patterns: `minimal`, `rest`, `ddd`, and `cqrs`. Each one generates a different number of files with a different structural philosophy. Instead of forcing you into one way of building modules, the generator lets you pick the right level of complexity for the job at hand. I have been building Vibed, a Jira-like task management backend, with KickJS for several months now. Along the way I have used all four patterns, and I want to walk through what each one gives you and when to reach for it.

## Pattern 1: minimal (2 files)

```bash
kick g module health --pattern minimal
```

This is the lightest possible module. Two files. That is it.

```
health/
├── index.ts
└── health.controller.ts
```

The `index.ts` file is your module definition. It implements `AppModule`, registers nothing in the DI container, and returns a single route pointing at the controller:

```typescript
import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';
import { buildRoutes } from '@forinda/kickjs';
import { HealthController } from './health.controller';

export class HealthModule implements AppModule {
  register(_container: Container): void {
    // No DI bindings needed
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(HealthController),
      controller: HealthController,
    };
  }
}
```

The controller is equally lean. No services, no repositories, no DTOs. Just decorated route handlers returning responses directly:

```typescript
import { Controller, Get } from '@forinda/kickjs';
import type { RequestContext } from '@forinda/kickjs';

@Controller()
export class HealthController {
  @Get('/health')
  async check(ctx: RequestContext) {
    ctx.json({ status: 'ok', timestamp: new Date().toISOString() });
  }
}
```

I use the minimal pattern for endpoints that do not touch the database or require any business logic. Health checks, version endpoints, static configuration responses, debug routes during development. In Vibed, the `StatsModule` started as a minimal module before it grew to need actual service dependencies. The pattern gives you a place to put code without imposing structure you do not need yet.

**When to use it:** Quick prototypes, static endpoints, health checks, anything where a controller alone is sufficient.

## Pattern 2: rest (11 files)

```bash
kick g module cats --pattern rest
```

This is the workhorse pattern. Eleven files in a flat structure that covers the full CRUD lifecycle:

```
cats/
├── index.ts
├── cats.controller.ts
├── cats.service.ts
├── cats.repository.ts
├── cats.types.ts
├── cats.dto.ts
├── cats.config.ts
├── cats.controller.test.ts
├── cats.service.test.ts
├── cats.repository.test.ts
└── _glob.ts
```

The service wraps the repository, the controller delegates to the service, and DTOs handle validation. No subdirectories, no layers to navigate. Everything for the `cats` module lives in one folder.

The generated repository ships with an in-memory implementation by default:

```typescript
import type { Cat, CreateCatDto, UpdateCatDto } from './cats.types';

export class CatsRepository {
  private items: Cat[] = [];
  private nextId = 1;

  async findAll(): Promise<Cat[]> {
    return [...this.items];
  }

  async findById(id: string): Promise<Cat | null> {
    return this.items.find(item => item.id === id) ?? null;
  }

  async create(dto: CreateCatDto): Promise<Cat> {
    const item: Cat = { id: String(this.nextId++), ...dto, createdAt: new Date(), updatedAt: new Date() };
    this.items.push(item);
    return item;
  }

  // ... update, delete methods
}
```

This is intentional. You get a working module the instant the generator finishes. No database setup required. When you are ready, you swap the in-memory store for your real persistence layer. A comment in the generated file even tells you where to make the swap for Drizzle or Prisma. In Vibed, we use MongoDB with Mongoose, so we replaced these with Mongo repository implementations, but the interface stayed the same.

The `cats.config.ts` file contains a `QueryFieldConfig` for pagination:

```typescript
import type { ApiQueryParamsConfig } from '@forinda/kickjs';

export const CATS_QUERY_CONFIG: ApiQueryParamsConfig = {
  filterable: ['breed', 'color'],
  sortable: ['name', 'createdAt'],
  searchable: ['name'],
};
```

This integrates directly with `ctx.paginate()` and `@ApiQueryParams()` for Swagger documentation. In Vibed, we centralized these configs in `shared/constants/query-configs.ts`, but the generator gives each module its own config file so it works out of the box.

The `_glob.ts` file is the auto-wiring mechanism:

```typescript
import.meta.glob(['./*.ts', '!./_glob.ts', '!./*.test.ts'], { eager: true });
```

I will explain why this matters in a dedicated section below.

**When to use it:** Most CRUD modules, rapid development, any time you want a flat structure with no ceremony. This is the pattern I reach for most often.

## Pattern 3: ddd (18 files)

```bash
kick g module cats --pattern ddd
```

Eighteen files across a full domain-driven design directory structure:

```
cats/
├── index.ts
├── _glob.ts
├── presentation/
│   └── cats.controller.ts
├── application/
│   ├── dtos/
│   │   ├── create-cat.dto.ts
│   │   └── update-cat.dto.ts
│   └── use-cases/
│       ├── create-cat.use-case.ts
│       ├── get-cat.use-case.ts
│       ├── list-cats.use-case.ts
│       ├── update-cat.use-case.ts
│       └── delete-cat.use-case.ts
├── domain/
│   ├── entities/
│   │   └── cat.entity.ts
│   ├── value-objects/
│   │   └── cat-id.vo.ts
│   ├── services/
│   │   └── cat-domain.service.ts
│   └── repositories/
│       └── cat.repository.ts
└── infrastructure/
    └── repositories/
        └── in-memory-cat.repository.ts
```

This is where things get interesting. The generator does not just create more files. It creates files with real architectural opinions baked in.

The domain entity uses a private constructor with factory methods:

```typescript
export class Cat {
  private constructor(
    public readonly id: CatId,
    public name: string,
    public breed: string,
    public age: number,
    public readonly createdAt: Date,
    public updatedAt: Date,
  ) {}

  static create(props: { name: string; breed: string; age: number }): Cat {
    return new Cat(
      CatId.generate(),
      props.name,
      props.breed,
      props.age,
      new Date(),
      new Date(),
    );
  }

  static reconstitute(props: {
    id: string; name: string; breed: string; age: number;
    createdAt: Date; updatedAt: Date;
  }): Cat {
    return new Cat(
      CatId.from(props.id),
      props.name,
      props.breed,
      props.age,
      props.createdAt,
      props.updatedAt,
    );
  }
}
```

The `create` factory is for new entities. The `reconstitute` factory is for rehydrating from persistence. This distinction matters because creation might involve generating IDs, setting defaults, or validating invariants, while reconstitution assumes the data is already valid. It is a pattern from the DDD playbook that the generator hands you for free.

The `CatId` value object wraps the raw string identifier:

```typescript
export class CatId {
  private constructor(private readonly value: string) {}

  static generate(): CatId {
    return new CatId(crypto.randomUUID());
  }

  static from(value: string): CatId {
    return new CatId(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: CatId): boolean {
    return this.value === other.value;
  }
}
```

The domain service layer is separate from the use cases. Use cases orchestrate application flow -- they call repositories, invoke domain services, and return results. Domain services contain business rules that do not belong to a single entity. This separation means your business logic survives even if you swap out your application framework.

The repository interface lives in `domain/repositories/`, and the implementation lives in `infrastructure/repositories/`. The use cases depend only on the interface:

```typescript
@Service()
export class CreateCatUseCase {
  constructor(
    @Inject(TOKENS.CAT_REPOSITORY) private catRepo: ICatRepository,
  ) {}

  async execute(dto: CreateCatDto): Promise<Cat> {
    const cat = Cat.create(dto);
    return this.catRepo.save(cat);
  }
}
```

Five use cases are generated: create, get, list, update, delete. Each one is a single-responsibility class. The controller uses `@Autowired()` to inject them all, and each route handler delegates to exactly one use case. This is the exact pattern we use throughout Vibed for modules like workspaces, tasks, and projects.

The `_glob.ts` in the DDD pattern casts a wider net:

```typescript
import.meta.glob([
  './presentation/**/*.ts',
  './application/**/*.ts',
  './domain/services/**/*.ts',
  './infrastructure/**/*.ts',
  '!./**/*.test.ts',
], { eager: true });
```

It reaches into every layer to ensure all decorated classes are loaded and registered in the DI container.

**When to use it:** Complex business logic, team projects where multiple developers touch the same module, long-lived codebases where you need clear boundaries between layers.

## Pattern 4: cqrs (17 files)

```bash
kick g module cats --pattern cqrs
```

Seventeen files with command/query separation and an event system:

```
cats/
├── index.ts
├── _glob.ts
├── commands/
│   ├── create-cat.command.ts
│   ├── update-cat.command.ts
│   └── delete-cat.command.ts
├── queries/
│   ├── get-cat.query.ts
│   └── list-cats.query.ts
├── events/
│   ├── cat-events.ts
│   ├── cat-created.handler.ts
│   ├── cat-updated.handler.ts
│   └── cat-deleted.handler.ts
├── dtos/
│   ├── create-cat.dto.ts
│   └── update-cat.dto.ts
├── cats.controller.ts
├── cats.types.ts
├── cats.repository.ts
└── cats.event-emitter.ts
```

The core idea here is that reads and writes are different operations with different concerns. Commands mutate state. Queries read it. Events broadcast what happened so other parts of the system can react.

The event emitter is strongly typed with a domain event map:

```typescript
import { EventEmitter } from 'events';
import type { Cat } from './cats.types';

export interface CatEventMap {
  'cat.created': [cat: Cat];
  'cat.updated': [cat: Cat];
  'cat.deleted': [id: string];
}

class CatEventEmitter extends EventEmitter {
  emit<K extends keyof CatEventMap>(event: K, ...args: CatEventMap[K]): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof CatEventMap>(event: K, listener: (...args: CatEventMap[K]) => void): this {
    return super.on(event, listener as any);
  }
}

export const catEvents = new CatEventEmitter();
```

This is not just a generic `EventEmitter`. The type parameter on `CatEventMap` means TypeScript enforces that you emit the right payload for each event name. If `cat.created` expects a `Cat` object, you cannot accidentally emit a string.

Commands emit events after performing their mutation:

```typescript
@Service()
export class CreateCatCommand {
  constructor(@Inject(TOKENS.CAT_REPOSITORY) private repo: CatsRepository) {}

  async execute(dto: CreateCatDto): Promise<Cat> {
    const cat = await this.repo.create(dto);
    catEvents.emit('cat.created', cat);
    return cat;
  }
}
```

Event handlers pick up those events for side effects:

```typescript
import { catEvents } from '../cats.event-emitter';

// WebSocket broadcast
catEvents.on('cat.created', (cat) => {
  // Broadcast via WS adapter
  console.log(`[WS] Broadcasting cat.created: ${cat.id}`);
});

// Queue dispatch
catEvents.on('cat.created', (cat) => {
  // Dispatch to BullMQ for async processing
  console.log(`[Queue] Dispatching cat.created job: ${cat.id}`);
});
```

The handlers are stubs, but they show you where to plug in WebSocket broadcasts, queue dispatches, audit trail logging, or cache invalidation. In Vibed, we use this pattern for features like real-time notifications and activity feeds, where creating a task should trigger events that multiple subsystems consume.

The `_glob.ts` for CQRS covers all the directories:

```typescript
import.meta.glob([
  './commands/**/*.ts',
  './queries/**/*.ts',
  './events/**/*.ts',
  '!./**/*.test.ts',
], { eager: true });
```

**When to use it:** Event-driven features, real-time applications, systems that need audit trails, anything where the write path and read path have fundamentally different requirements.

## Auto-Wiring: The Generator Updates Your Module Registry

When you run `kick g module`, the generator does not just create files in a new directory. It also updates `src/modules/index.ts` automatically. In Vibed, that file looks like this:

```typescript
import type { AppModuleClass } from '@forinda/kickjs';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
// ... other imports

export const modules: AppModuleClass[] = [
  AuthModule,
  UsersModule,
  WorkspacesModule,
  // ... other modules
];
```

The generator appends your new module's import and adds it to the array. No manual wiring. This matters more than it sounds, because forgetting to register a module is one of those bugs that gives you no error message -- your routes simply do not exist, and you spend twenty minutes wondering why Postman returns 404.

## The import.meta.glob Pattern

Every generated pattern except `minimal` includes a `_glob.ts` file (or inlines the glob in `index.ts`). This file uses Vite's `import.meta.glob` with `{ eager: true }`:

```typescript
import.meta.glob(['./**/*.ts', '!./**/*.test.ts'], { eager: true });
```

Why does this exist? In KickJS, decorated classes (`@Service()`, `@Controller()`, etc.) register themselves in the DI container as a side effect of being imported. If a file is never imported, its decorators never run, and the container does not know it exists.

Explicit imports work, but they are fragile. Every time you add a new use case or service, you have to remember to import it somewhere. `import.meta.glob` solves this by loading all `.ts` files in the module directory tree at build time.

Here is what happens under the hood:

1. Vite evaluates the glob pattern at build time, resolving it to a static list of file paths.
2. The `{ eager: true }` option loads all matched files synchronously, as if you had written individual `import` statements for each one.
3. Each imported file's top-level code executes, which includes decorator registration as a side effect.
4. During HMR, when a file changes, Vite re-evaluates the glob and re-imports the affected modules.

This is why the pattern survives hot module replacement. The glob re-evaluates on every rebuild, picking up new files and dropping deleted ones without any manual intervention. You add a new use case file, save it, and HMR ensures it is registered in the container immediately.

## Choosing a Pattern: The Decision Matrix

After months of building with all four patterns, here is how I decide:

| Scenario | Pattern | Why |
|----------|---------|-----|
| Prototype or spike | `minimal` | Two files, zero overhead, prove the concept first |
| Standard CRUD resource | `rest` | Flat structure, fast to navigate, covers 80% of modules |
| Complex business domain | `ddd` | Layer separation protects invariants, scales with team size |
| Event-driven feature | `cqrs` | Command/query split, typed events, natural fit for real-time |

The patterns are not mutually exclusive within a project. In Vibed, we have modules at different complexity levels. The stats module is essentially minimal. The workspaces module follows DDD conventions. If we were to add a live collaboration feature, CQRS would be the natural choice. KickJS does not enforce uniformity -- you pick the right tool for each module.

## The --repo Flag

The generator also accepts a `--repo` flag to control what persistence layer the generated repository uses:

```bash
kick g module cats --pattern rest --repo inmemory
kick g module cats --pattern rest --repo drizzle
kick g module cats --pattern rest --repo prisma
```

The `inmemory` option is the default. It gives you a working module with no database dependency, which is great for prototyping and testing. The `drizzle` option generates a repository that uses Drizzle ORM with typed schemas. The `prisma` option generates one that delegates to a Prisma client.

In Vibed, we use MongoDB with Mongoose, which is not one of the generator's built-in options. We wrote our repository implementations by hand, following the interface contracts that the DDD pattern generates. The key point is that the generator gives you a starting point and a clear interface boundary. Whether you use the generated repository or write your own, the rest of the module -- controllers, use cases, DTOs -- does not change.

## Wrapping Up

The `kick g module` command is more than a code generator. It is a decision framework. By offering four distinct patterns, it forces you to think about the architectural needs of each module before you write a single line of business logic. The minimal pattern keeps you honest about simplicity. The rest pattern gets you moving fast. The DDD pattern protects your domain. The CQRS pattern embraces events as first-class citizens.

After building Vibed across all four patterns, my advice is straightforward: start with `minimal` or `rest`, and promote to `ddd` or `cqrs` when the module's complexity demands it. The generator makes that promotion path cheap, and `import.meta.glob` ensures you never have to manually wire up your DI container along the way.

```bash
# Start simple
kick g module health --pattern minimal

# Standard CRUD
kick g module cats --pattern rest

# When the domain gets complex
kick g module billing --pattern ddd

# When events drive the feature
kick g module notifications --pattern cqrs
```

Four commands, four architectures, one framework. That is the kind of flexibility I want in a backend toolkit.
