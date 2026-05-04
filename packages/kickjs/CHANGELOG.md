# @forinda/kickjs

## 5.3.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

## 5.3.0

### Minor Changes

- [#161](https://github.com/forinda/kick-js/pull/161) [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98) Thanks [@forinda](https://github.com/forinda)! - Add `withBuilder()` factory alongside `@Builder`. Both share the same runtime via the new internal `attachBuilder()` helper.

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
