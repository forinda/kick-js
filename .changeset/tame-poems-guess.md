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

Both forms are now accepted. A factory carries a frozen `definition` and a
`scoped` helper, neither of which a class has, so the two are distinguishable
with certainty. Calling it with no arguments produces exactly what `Module()`
would, so this is equivalent rather than lenient.

When an entry is a function that is neither, the error now names it and says
what both valid shapes are, instead of surfacing a bare constructor complaint
from inside the framework.
