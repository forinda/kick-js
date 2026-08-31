---
'@forinda/kickjs': patch
---

Accept a `defineModule()` factory passed uninvoked.

A module factory and a module class are both functions, so `typeof` cannot tell
them apart. Passing the factory bare reached `new factory()` and died with:

```text
TypeError: entry is not a constructor
```

naming neither the offending module nor the fix. It is easy to hit because the
class form _does_ take the bare name, so the two styles read as
interchangeable — and the scaffolded test guidance showed the class form even
in projects the generator emits as `define`.

A factory carries a frozen `definition` and a `scoped` helper, neither of which
a class has, so the two are distinguishable with certainty.

The bare form is accepted **only for a module that takes no configuration**,
where calling the factory with no arguments produces exactly what `Module()`
would — equivalent rather than lenient.

A configurable module still refuses it, because there the two are not
equivalent in intent: the bare name silently selects the defaults, so an author
who meant `TenantModule({ region })` would get a running app wired the wrong
way with nothing said. That is the failure mode this change exists to remove,
so it stays loud — now with a message that names the module and both correct
spellings:

```text
bootstrap: module `TenantModule` takes configuration, so it must be invoked.
  Write `TenantModule()` for its defaults, or `TenantModule({ … })` to configure it.
  Passing it bare would have silently selected the defaults.
```

When an entry is a function that is neither, the error now names it and says
what both valid shapes are, instead of surfacing a bare constructor complaint
from inside the framework.
