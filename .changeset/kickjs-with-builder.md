---
'@forinda/kickjs': minor
---

Add `withBuilder()` factory alongside `@Builder`. Both share the same runtime via the new internal `attachBuilder()` helper.

```ts
// Decorator form — opt into typing with one line
@Builder
class UserDto {
  name!: string
  email!: string
  declare static readonly builder: () => BuilderOf<UserDto>
}

// Factory form — same runtime, types inferred automatically
class TaskDtoBase {
  title!: string
  done!: boolean
}
export const TaskDto = withBuilder(TaskDtoBase)
export type TaskDto = InstanceType<typeof TaskDto>
```

`readonly` keeps SonarQube's `typescript:S1444` quiet — the runtime assigns `target.builder` once at decoration time and never reassigns it. Existing `@Builder` adopters keep working without changes; the typing opt-in is additive.
