---
'@forinda/kickjs': minor
---

Route flags: removal is `@Flag.off`, and `false` becomes an ordinary value.

`false` was doing two jobs — "remove this flag" and "the value false" — and the first won. A flag declared `boolean` could never read back as `false`, because `@Enabled(false)` deleted it:

```ts
const Enabled = defineRouteFlag<boolean>('feature.enabled')

@Enabled(false)                       // before: removed the flag
                                      // now:    stores false
flags.get('feature.enabled')          // before: undefined
                                      // now:    false
```

Removal now has its own spelling, applied bare like the flag itself:

```ts
@Public
@Controller()
class WebhooksController {
  @Public.off // drops what the controller set
  @Post('/admin')
  admin(ctx) {}
}
```

`@Flag(false)` on a flag whose declared value is `true` is now a compile error pointing you at `.off`, so the old form cannot silently change meaning. Nothing else about resolution changed: a flag is absent or present, and `has()` remains the right question.

Also: `defineRouteFlag` rejects a name starting with `!`, which is reserved for negated tests — `'!x'` as a name would be indistinguishable from the negation of `'x'`.
