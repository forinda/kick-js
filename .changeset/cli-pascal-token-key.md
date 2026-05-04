---
'@forinda/kickjs-cli': patch
---

Token generator now emits PascalCase for the key segment so scaffolded
`createToken<T>('<scope>/<Key>/<suffix>')` literals satisfy the §22.2
convention regex out of the box (no `kick-lint` warning on fresh
scaffolds).

Before:

```ts
export const USER_REPOSITORY = createToken<IUserRepository>('app/user/repository')
```

After:

```ts
export const USER_REPOSITORY = createToken<IUserRepository>('app/User/repository')
```

Existing scaffolded code keeps working — token literals are arbitrary
strings; only newly generated files are affected. Generated docs
(`AGENTS.md`, `CLAUDE.md`, `README.md`) updated to reflect the
PascalCase key convention.
