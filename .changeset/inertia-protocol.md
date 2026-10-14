---
'@forinda/kickjs-inertia': minor
---

More of the Inertia v3 protocol:

- `once(fn, { key, ttl })` — a prop the client keeps; later visits skip resolving it.
- `scroll(fn, options)` — a page of an `<InfiniteScroll>` list. It reads `{ data, meta: { page, hasNext, hasPrev } }` by default.
- `merge(value, mode, { matchOn })` — merged rows replace the ones with the same id instead of being added again.
- `redirect()` to a URL with a `#fragment` keeps the fragment on an Inertia visit, and `redirect(url, { preserveFragment: true })` / `back(ctx, fallback, { preserveFragment: true })` return to the fragment the form was posted from.
- `@Middleware(precognitive)` — live validation for `useForm().validate()`. The route's schema runs and the handler doesn't; `inertiaErrorHandler()` reports only the fields the form asked about.
