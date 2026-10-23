---
'@forinda/kickjs-view': minor
---

Your own browser validators: each export of `src/views/validators.ts` is a validator usable in `validate="…"` beside the built-ins (`validate="required | phone"`, `validate="sameAs:'password'"`). A validator gets the value, the template's arguments and the form, and returns a message when the value fails. Names are checked like pipes, and an export named like a built-in is an error. The file ships as `kick-validators.<hash>.js` on pages with a `validate` field. New: `validatorsFile` option, `readValidatorExports`, `BUILTIN_VALIDATORS`, `kick check:views --validators`.
