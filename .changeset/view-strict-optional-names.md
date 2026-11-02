---
'@forinda/kickjs-view': patch
---

In strict mode, a name the data doesn't have no longer fails the render when it's on the left of `??` or before `?.`. `{{ showPositions ?? true }}` and `{{ fees?.paid }}` now work for optional fields; a missing name anywhere else is still an error.
