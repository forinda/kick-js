---
'@forinda/kickjs-devtools': minor
---

The DevTools dashboard has an API runner. **Try** on a row of the Routes tab opens a side sheet that sends a request to that route from the browser, on the same origin, so it works on every runtime with no extra endpoint.

**Sections** (each collapsible):

- **Path params:** one field per `:param`.
- **Query and headers:** key/value rows that can be switched off.
- **Body:** raw text, for methods that take one.
- **Defaults & settings:** default headers, kept only for the browser tab.
- **Code snippet:** the request rendered as `curl` or `fetch`, readable and selectable.
- **Response:** status, time, headers, and the body pretty-printed as JSON.

**Built-in handling:**

- It reads the CSRF cookie and sends the matching header on unsafe methods.
- It leaves out a default `Authorization` header on routes carrying a public route flag. The flag name is configurable, and several can be listed.
- `DELETE`, `PUT` and `PATCH` need a second click before they're sent.
- The devtools token is never sent to app routes.
