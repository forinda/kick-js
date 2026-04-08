---
title: "KickJS DI Container Gotchas: When @Service() Doesn't Actually Register Your Class"
description: "Debugging silent DI failures in a decorator-driven Node.js backend — how @Service() metadata, @Job() processors, and container registration interact in unexpected ways."
tags: ["kickjs", "nodejs", "typescript", "mongodb", "dependency-injection"]
canonical_url: null
published: false
---

# DI Container Gotchas: When @Service() Doesn't Actually Register Your Class

I spent two days debugging a problem that boiled down to this: decorating a class with `@Service()` does not register it in the DI container. It sets metadata. Registration is a separate step that happens somewhere else, and if that "somewhere else" does not run, your class exists in memory but is invisible to the rest of your application.

This article covers what I learned building queue processors for Vibed, a Jira-like task management backend built with KickJS. The lessons apply to any decorator-based DI system in TypeScript -- NestJS, InversifyJS, tsyringe, or custom implementations.

## The Setup: Queue Processors That Worked on Restart but Broke on Cold Boot

Vibed uses BullMQ for background job processing. Email notifications, activity logging, and push notifications each have a dedicated processor class decorated with `@Job()` and `@Service()`:

```typescript
// src/modules/queue/infrastructure/processors/email.processor.ts
@Service()
@Job('email')
export class EmailProcessor {
  @Autowired(MAILER) private mailer!: MailerService;

  @Process('send-welcome-email')
  async sendWelcome(job: BullMQJob<{ email: string; firstName: string }>) {
    logger.info(`Sending welcome email to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `Welcome to Vibed, ${job.data.firstName}!`,
      html: `<h1>Welcome to Vibed!</h1><p>Hi ${job.data.firstName}, your account is ready.</p>`,
    });
  }

  @Process('send-task-assigned')
  async sendTaskAssigned(job: BullMQJob<{ email: string; taskKey: string; taskTitle: string; assignerName: string }>) {
    logger.info(`Sending task assigned email to ${job.data.email}`);
    await this.mailer.send({
      to: job.data.email,
      subject: `You were assigned to ${job.data.taskKey}: ${job.data.taskTitle}`,
      html: `<p>${job.data.assignerName} assigned you to <strong>${job.data.taskKey}</strong>: ${job.data.taskTitle}</p>`,
    });
  }

  // ... more processors
}
```

The module file imported these processors as side effects to ensure the decorators ran:

```typescript
// src/modules/queue/queue.module.ts
import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';
import './infrastructure/processors/email.processor';
import './infrastructure/processors/notification.processor';
import './infrastructure/processors/activity.processor';

export class QueueModule implements AppModule {
  register(_container: Container): void {
    // Nothing here -- we assumed @Service() handled registration
  }

  routes(): ModuleRoutes | null {
    return null;
  }
}
```

On a fresh `kick dev` start, this worked. Emails sent. Notifications delivered. Then I changed something in a controller, HMR kicked in, and the logs filled with:

```
No binding found for: EmailProcessor
No binding found for: NotificationProcessor
No binding found for: ActivityProcessor
```

Jobs started piling up in the queue. Nothing was processing them.

## The Root Cause: Decorators Set Metadata, They Don't Register

`@Service()` marks a class as injectable — it does not register it in the container by itself. Registration happens later when another component (like `buildRoutes()` or an adapter) discovers the class and registers it. This is a common pattern in decorator-based DI systems.

For controllers, `buildRoutes(TasksController)` discovers and registers the class. For repositories, the module's `register()` method explicitly binds the token:

```typescript
// src/modules/tasks/tasks.module.ts
export class TasksModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.TASK_REPOSITORY, () =>
      container.resolve(MongoTaskRepository),
    );
  }
}
```

For queue processors, the `QueueAdapter` is supposed to discover classes decorated with `@Job()` and register them. And it does -- on cold boot. The problem is what happens next.

## How We Discovered This: The HMR Class Identity Problem

When Vite HMR re-evaluates a module file, the JavaScript runtime creates a **new class object**. The class has the same name, the same methods, the same decorators. But it is a different object in memory. `OldEmailProcessor !== NewEmailProcessor`.

The DI container stored a binding for `OldEmailProcessor`. When `QueueAdapter.beforeStart()` ran during rebuild, it tried to resolve `NewEmailProcessor` -- which had no binding. Hence the error.

But this was not just an HMR problem. It revealed a deeper architectural issue: **the registration path for queue processors was implicit and fragile**. It depended on:

1. The side-effect import running before the adapter starts
2. The `@Job()` decorator populating a global registry
3. The `QueueAdapter` reading that registry at exactly the right time
4. No module re-evaluation happening between steps 2 and 3

Any break in that chain, and the processor silently vanishes from the container.

## The Workaround: Explicit Registration

Before KickJS patched this, I had two workarounds.

**Workaround 1: Manual registration in the module.** Instead of trusting the decorator chain, register processors explicitly:

```typescript
export class QueueModule implements AppModule {
  register(container: Container): void {
    // Explicitly register each processor
    container.register(EmailProcessor);
    container.register(NotificationProcessor);
    container.register(ActivityProcessor);
  }

  routes(): ModuleRoutes | null {
    return null;
  }
}
```

This works but defeats the purpose of `@Service()`. You are doing manually what the decorator was supposed to do.

**Workaround 2: Deferred registration with `queueMicrotask`.** I wrote a custom decorator that defers `container.register()` to the next microtask, ensuring the container exists before registration. This worked but was fragile and timing-dependent — not recommended.

## The Fix: QueueAdapter Auto-Registration (v1.2.6)

KickJS v1.2.6 changed the `QueueAdapter` to auto-register `@Job` classes in the container before resolving them. The side-effect imports still need to run (so the `@Job()` decorator populates the registry), but the adapter handles registration. The QueueModule becomes minimal:

```typescript
// src/modules/queue/queue.module.ts — current version
export class QueueModule implements AppModule {
  register(_container: Container): void {
    // No manual registration needed — QueueAdapter v1.2.6+ auto-registers
    // @Job classes in the container before resolving them.
  }

  routes(): ModuleRoutes | null {
    return null;
  }
}
```

## The HMR Fix (v1.2.7)

The cold boot problem was solved, but HMR still broke processors. KickJS v1.2.7 addressed this by making the container and adapters HMR-aware:

- **String-keyed registration persistence** — registered classes survive container resets using name-based keys instead of object identity, so classes re-created by HMR are matched to their previous bindings.
- **Adapter reset hooks** — adapters like `QueueAdapter` are notified after a container reset and re-register their managed classes with the fresh class identities.

The result: HMR re-evaluates your processor file, the adapter picks up the new class, and workers continue processing without interruption.

## Lessons Learned About Decorator-Based DI

### 1. Decorators are metadata, not behavior

This is the most important takeaway. In every decorator-based DI system I have seen, the decorator itself just writes metadata. Something else reads that metadata and acts on it. If that "something else" does not run, or runs at the wrong time, the decorator is inert.

When debugging DI issues, do not ask "is the decorator applied?" Ask "what reads this metadata, and when does it run?"

### 2. Registration and resolution are separate concerns

Registration binds a token (or class) to a factory or instance. Resolution looks up that binding and returns an instance. Most DI bugs are registration bugs, not resolution bugs. The error says "cannot resolve X" but the fix is "register X in the right place."

### 3. Object identity matters more than you think

In languages with a single class loading mechanism (Java, C#), a class is a class. In JavaScript with HMR, bundlers, or dynamic imports, the same source code can produce multiple class objects. DI containers that use class references as keys (which is most of them) will fail silently when the class identity changes.

If you are building a DI container, consider supporting string-based fallback keys. If you are using one, be aware that hot reloading, re-imports, and dynamic `import()` can all change class identity.

### 4. Side-effect imports are a code smell (but sometimes necessary)

Vibed's queue module relies on side-effect imports:

```typescript
import './infrastructure/processors/email.processor';
import './infrastructure/processors/notification.processor';
import './infrastructure/processors/activity.processor';
```

These exist solely to make `@Job()` and `@Service()` decorators execute, populating global registries. This is fragile because:

- Tree-shaking can remove them if nothing references the exports
- Import order matters if registries are read during module evaluation
- It is not obvious why they exist without a comment

The better pattern, which KickJS moved toward in v1.2.6, is for the adapter to scan for decorated classes and handle registration itself. But when working with frameworks that have not made that leap yet, side-effect imports with clear comments are the pragmatic choice.

### 5. Test your DI from a cold start

During development, I was mostly testing with HMR -- the server was already running, and I was making incremental changes. The processors worked because they were registered during the initial cold boot. It was only when I stopped the server, cleared the Redis queue, and started fresh that I caught the timing bug.

Every time you add a new DI-dependent class, restart the server from scratch and verify it resolves. Do not trust HMR to tell you whether registration is correct.

### 6. The simplest fix is often explicit registration

When decorators fail, when timing is wrong, when framework magic does not fire -- just call `container.register(MyClass)` directly. It is one line. It is obvious. It always works. You can refactor to something more elegant later when you understand the registration lifecycle better.

## The Pattern I Use Now

For every new module in Vibed, I follow this checklist:

1. **Controllers and services with `@Autowired()`**: These resolve by class type. `buildRoutes()` handles registration. No manual step needed.

2. **Repositories with `@Inject(TOKEN)` in use case constructors**: Register the factory in the module's `register()` method. Always.

3. **Queue processors with `@Job()`**: Side-effect import in the module file, let `QueueAdapter` auto-register. Comment why the import exists.

4. **Framework services (mailer, queue manager)**: Use constructor `@Inject(SYMBOL)` or `@Autowired(SYMBOL)`. These are registered by the adapter, not by my code.

5. **Test from cold boot**: After adding any new DI binding, restart the server and verify.

The decorator-based DI model is powerful when it works. When it does not, the debugging is harder than manual wiring because the registration path is invisible. Knowing where the metadata goes and who reads it turns those invisible paths into traceable ones.
