---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': minor
'@forinda/kickjs-storage': patch
---

Settings sections can be declared `.optional()`: listed by `kick env example` and `app.describeConfig()`, but not validated or bound at startup — `get()` validates one when it's used. For a section only one driver reads, picked at run time (SMTP or Resend by `MAIL_DRIVER`, a bucket only production uses), which until now either had to be required at startup or was left out of `.env.example`. Works in every `settings` list: `bootstrap()`, modules, adapters and plugins. `kick env example` comments every variable of an optional section, marks the required ones "required when used", and writes a section schema's own description under its heading. The `S3Settings` variables now carry descriptions.
