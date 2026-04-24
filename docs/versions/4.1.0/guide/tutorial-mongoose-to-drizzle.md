# Why We Switched from Mongoose to Drizzle ORM

*Part 1 of "Building a Task Management App with KickJS + Drizzle ORM"*

---

We built Vibed — a task management backend — twice. The first time with MongoDB and Mongoose. The second with PostgreSQL and Drizzle ORM. This article covers why we made the switch and what changed.

## The Original Stack

The first Vibed was built on:
- **KickJS** — a decorator-driven Node.js framework on Express 5
- **MongoDB** with Mongoose ODM
- **Embedded arrays** for many-to-many relationships (assigneeIds, labelIds, memberIds on documents)

It worked. But as the schema grew to 16 entities with complex relationships, we kept running into friction.

## Problem 1: Type Safety Was Manual

Mongoose schemas and TypeScript interfaces lived in separate worlds. Every entity had a manually-written interface that could drift from the actual schema:

```typescript
// The schema
const taskSchema = new Schema({
  title: { type: String, required: true },
  assigneeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
});

// The interface — manually kept in sync
interface ITask {
  title: string;
  assigneeIds: Types.ObjectId[];
}
```

With Drizzle, the schema IS the type:

```typescript
export const tasks = pgTable('tasks', {
  title: varchar('title', { length: 255 }).notNull(),
  // ...
});

// Type is derived automatically
type Task = typeof tasks.$inferSelect;
type NewTask = typeof tasks.$inferInsert;
```

No drift. No manual interfaces. `$inferSelect` gives you the exact shape of a row, and `$inferInsert` gives you what you need to create one.

## Problem 2: Many-to-Many Was Fragile

MongoDB's approach of embedding ObjectId arrays inside documents seemed convenient at first:

```typescript
// Mongoose: assignees lived on the task document
task.assigneeIds = [userId1, userId2];
await task.save();
```

But this created problems:
- **No referential integrity** — delete a user, and their stale ObjectId stays in every task's assigneeIds array
- **Aggregation complexity** — counting tasks per assignee required `$unwind` pipelines
- **Atomic updates** — adding/removing from arrays needed `$push`/`$pull` with race condition risks

With PostgreSQL + Drizzle, many-to-many uses explicit join tables:

```typescript
export const taskAssignees = pgTable('task_assignees', {
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
}, (t) => [primaryKey({ columns: [t.taskId, t.userId] })]);
```

Foreign keys with `onDelete: 'cascade'` handle cleanup automatically. Adding an assignee is a simple insert. Removing is a simple delete. No array manipulation, no race conditions.

## Problem 3: Transactions Were an Afterthought

MongoDB transactions require replica sets. In development, most people run a standalone mongod, which means no transactions. You'd only discover transaction bugs in staging.

PostgreSQL transactions work everywhere, always:

```typescript
await this.db.transaction(async (tx) => {
  const [task] = await tx.insert(tasks).values(taskData).returning();
  await tx.insert(taskAssignees).values(
    assigneeIds.map(userId => ({ taskId: task.id, userId })),
  );
  return task;
});
```

We use this for task creation (insert task + assignees atomically), workspace creation (insert workspace + add owner as admin), and anywhere we need multi-table consistency.

## Problem 4: Counter Fields Needed Atomic SQL

Vibed tracks `commentCount` and `attachmentCount` on tasks. With Mongoose, incrementing a counter was:

```typescript
await TaskModel.updateOne({ _id: taskId }, { $inc: { commentCount: 1 } });
```

The Drizzle equivalent uses SQL template literals:

```typescript
await this.db
  .update(tasks)
  .set({ commentCount: sql`${tasks.commentCount} + 1` })
  .where(eq(tasks.id, taskId));
```

Both are atomic. But the Drizzle version composes better — you can wrap it in a transaction with the comment insert, and the `sql` template gives you access to any SQL expression, not just `$inc`.

## What We Learned: The baseColumns Trap

One gotcha that cost us time: Drizzle's type inference breaks when you spread a pre-built object into `pgTable`.

```typescript
// BROKEN — $inferSelect resolves to {}
const baseColumns = {
  id: uuid('id').defaultRandom().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
};

export const users = pgTable('users', {
  ...baseColumns,  // ← Type inference lost
  email: varchar('email', { length: 255 }).notNull(),
});
```

The fix: make `baseColumns` a function that returns fresh column builders each time:

```typescript
// WORKS — each call returns new builder instances
const baseColumns = () => ({
  id: uuid('id').defaultRandom().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull().$onUpdate(() => new Date()),
});

export const users = pgTable('users', {
  ...baseColumns(),  // ← Type inference works
  email: varchar('email', { length: 255 }).notNull(),
});
```

This is a Drizzle-specific behavior — TypeScript can infer the return type of a function call but loses track of a plain object's column types after spreading.

## What We Kept the Same

Not everything changed. The module architecture, DI patterns, and controller structure remained identical between Mongoose and Drizzle editions:

- **DDD module structure**: presentation → application → domain → infrastructure
- **Repository pattern**: interfaces in domain, implementations in infrastructure
- **Use cases**: thin orchestrators that call repos and domain services
- **Guards**: resolve repos from the DI container at request time
- **Auth**: JWT validation via `authBridgeMiddleware`, `getUser(ctx)` helper

The framework (KickJS) is ORM-agnostic. Swapping Mongoose for Drizzle only changed the infrastructure layer and schema definitions. Everything above the repository interface stayed the same.

## The Numbers

| Metric | Mongoose Edition | Drizzle Edition |
|--------|-----------------|-----------------|
| Schema files | 16 models | 16 tables + 16 relations + 5 enums |
| Manual type interfaces | 16 | 0 (all inferred) |
| Migration strategy | Schema-on-write | Explicit (`drizzle-kit push/migrate`) |
| Many-to-many | Embedded arrays | 3 join tables |
| Referential integrity | Application-enforced | Database-enforced (FK constraints) |
| Transactions | Requires replica set | Always available |

## Next Up

In [Part 2](/guide/tutorial-ddd-architecture), we'll cover how the DDD module architecture works with KickJS's decorator-driven approach, and why the `kick g module` generator saves more time than you'd think.
