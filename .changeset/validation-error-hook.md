---
'@forinda/kickjs': minor
---

`bootstrap({ validationError })` and `createWebApp({ validationError })` decide what a failed route validation throws. The hook receives `{ source, issues, req }` and returns (or throws) the error, for example a `ProblemException` with your own status and fields. Return `undefined` to keep the default 422 for that failure. Each app's routes use that app's hook; a standalone `validate(schema, { validationError })` takes it too. `defaultValidationError` and the `ValidationFailure` / `ValidationErrorFactory` types are exported.
