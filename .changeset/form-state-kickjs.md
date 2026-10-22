---
'@forinda/kickjs': minor
---

Form state for server-rendered forms. `formErrorHandler()` (pass to `bootstrap({ onError })`; with Inertia, `formErrorHandler(inertiaErrorHandler())`) turns a browser form submit that fails route validation into a 303 back to the form. It keeps the field errors and the submitted values in the session, and goes back to the last full page the session rendered, else the same-site `Referer`, else `fallbackUrl` (default `/`). `fetch()` with `FormData` keeps getting the usual JSON error. `flash(ctx, data)` leaves messages for the next page, with the same session key as `@forinda/kickjs-inertia`'s, so it works for Inertia pages and `.kick` views alike. `fieldErrors(details)` and `oldInput(body)` are exported too. Old input leaves out secrets (`SECRET_FIELD`) and files and is capped in bytes (1,000 a field, 1,500 in all), so a cookie session can't overflow.
