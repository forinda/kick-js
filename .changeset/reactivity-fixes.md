---
'@forinda/kickjs': minor
---

Reactivity fixes and additions.

**Fixed:**

- **A throwing `watch` callback or `subscribe` handler no longer breaks the write that triggered it, or the other watchers.** The error is logged and reported to `onError` observers (`source: 'watch'`). Before, a watcher on `app.status` that threw would interrupt `shutdown()`.
- **`isRef()` and `unref()` recognise computed refs.** `unref(computed)` returned the computed object itself.
- **`toRefs()` returns live views onto the object, not copies.** The new `toRef(obj, key)` gives one.
- **`reactive()` now tracks** nested arrays (`state.list.push(x)`), `delete`, key iteration (`Object.keys`, `for…in`) and `in`. It also returns an existing proxy unchanged instead of wrapping it again.

**Added:**

- **`batch(fn)`** groups writes, so watchers and subscribers run once, after it, with the final values. Computed values stay current inside a batch.
- **`ref(value, { deep: true })`** makes changes inside an object value notify too.
- **Loop detection:** an effect that re-triggers itself 100 levels deep, such as a watcher writing to what it watches, is stopped and reported instead of overflowing the stack. Long chains of updates, which run one after another, are not affected.
