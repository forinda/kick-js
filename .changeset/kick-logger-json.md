---
'@forinda/kickjs': minor
---

The logger gains JSON output and fields, with the default output unchanged.

- **`LOG_FORMAT=json`** makes the default provider write one JSON object per line, using pino's field names (`level` 10–60, `time` in epoch ms, `msg`), so `pino-pretty` and log shippers read it as is. Trailing plain objects become fields, an `Error` becomes `err` with its stack, own properties and `cause` chain, and `%s` / `%d` placeholders are filled like `console.log` fills them.
- **`logger.child({ ... })`** returns a logger carrying those fields on every line, keeping its name and parent fields. `child('Name')` works as before.
- **`requestLogger()`** writes the same line, with `method`, `path`, `status`, `ms` and `requestId` as fields.
- **`LoggerProvider.child()`** receives the fields alongside `component`; a provider that reads only `component` keeps working.
- **Nothing changes by default:** without `LOG_FORMAT=json` the text lines are the same as before, written through the same `console` methods.
- **Logged data can't rewrite a line:** `level`, `time`, `component`, `msg` and `err` come from the logger, so a logged object — often a request body — can't change a line's severity or source, or pose as the error.
- **Docs:** the pino and winston recipes in the logging guide lost errors, fields or placeholders; both now hand their library a finished message and an object of fields. A new "Where logs go" section covers files, an errors-only file, streams, rotation and log services with pino targets and winston transports.
