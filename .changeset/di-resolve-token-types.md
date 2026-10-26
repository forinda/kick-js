---
'@forinda/kickjs-di': patch
---

`container.resolve()` infers the type of abstract classes and classes with a private or protected constructor, which used to come back as `any`. A value that isn't a token, such as the Promise from an `import()` you forgot to `await`, is now a compile error instead of an untyped `any` that throws at runtime. Strings and symbols typegen doesn't know, and `any`-typed tokens, still return `any`, and an explicit type still overrides a token's: `resolve<Wider>(TOKEN)`.
