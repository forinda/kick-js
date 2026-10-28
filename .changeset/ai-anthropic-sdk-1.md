---
'@forinda/kickjs-ai': patch
---

`AnthropicProvider` works with `@anthropic-ai/sdk` 1.x. That SDK sends API version `2026-10-21`, which rejects `temperature` and `top_p` on every model and has no replacement for them, so with a 1.x client the provider leaves them out of the request and warns once. With a 0.x client it sends them as before, to the models that accept them. The version is read from the client in use, including one you pass as `client`; the new `sampling` option overrides it for a client that sends a different `anthropic-version`. The supported SDK range is unchanged (`>=0.126.0`).
