---
'@forinda/kickjs-ai': patch
---

`AnthropicProvider` works with `@anthropic-ai/sdk` 1.x. That SDK sends API version `2026-10-21`, which rejects `temperature` and `top_p` on every model, so the provider now drops them with a one-time warning whenever the installed SDK is 1.x — use `effort` instead. With SDK 0.x it sends them as before, to the models that accept them. The supported SDK range is unchanged (`>=0.126.0`).
