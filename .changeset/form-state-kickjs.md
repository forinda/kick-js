---
'@forinda/kickjs': minor
---

Form state for server-rendered forms. `formErrorHandler()` (pass to `bootstrap({ onError })`, or wrap it in `inertiaErrorHandler()`) turns a browser form post that fails route validation into a 303 back to the form. It keeps the field errors and the submitted values in the session, and goes back to the same-site `Referer`, else `fallbackUrl` (default `/`). `flash(ctx, data)` leaves messages for the next page, with the same session key as `@forinda/kickjs-inertia`'s, so it works for Inertia pages and `.kick` views alike. `fieldErrors(details)` and `oldInput(body)` are exported too. Old input leaves out secrets and files and is capped (1,000 characters a field, 2,000 in all), so a cookie session can't overflow.
