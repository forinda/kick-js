---
'@forinda/kickjs-view': patch
---

Template edits show up on the next request under `kick dev` again when you pass your own `createViews({ ...kickViews })` to `KickView({ views })`, the setup the guide shows. `createViews` now turns on its source re-check by default when `bundle` is `null`, which is what `virtual:kick-views` hands over in dev.
