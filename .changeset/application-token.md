---
'@forinda/kickjs': minor
---

`APPLICATION` — a DI token for the running `Application`, bound when the app is constructed and on each `setup()`. Inject it where a service needs the app itself, e.g. `describeConfig()`: `constructor(@Inject(APPLICATION) private readonly app: Application) {}`.
