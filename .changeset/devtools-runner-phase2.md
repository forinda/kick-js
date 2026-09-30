---
'@forinda/kickjs-devtools': minor
---

The API runner gains history, OpenAPI prefill, and open handler in editor.

- **History:** the last 30 requests across all routes, with status and time. Click one to reopen its route with the inputs it was sent with. Kept in `localStorage`, with `{{variables}}` as written rather than their values.
- **OpenAPI prefill:** when the app serves a spec (`/openapi.json` by default, configurable), a route opened for the first time gets its query parameters and an example JSON body from the request schema. Summaries and parameter descriptions show as hints, and **Fill empty inputs from OpenAPI** applies it later without overwriting what you typed.
- **Open in editor:** click the handler name in the runner to open it in your editor, through a configurable link (`vscode://file{file}:{line}` by default).
- **`GET /_debug/source?controller=&handler=`:** new endpoint that finds a registered route's handler under the project's `src/`. The VS Code extension uses it too.
