---
'@forinda/kickjs-ai': minor
---

`OpenAIProvider` and `AnthropicProvider` take a `fetch` option that sends every request in place of the global `fetch`. Use it for a proxy or custom TLS (an undici `Agent`), tracing model calls, gateway headers, or a runtime without a global `fetch`.

- **OpenAI:** chat, streaming, embeddings and retries all go through it.
- **Anthropic:** it's passed to the SDK client the provider creates. If you pass your own `client`, give that client its `fetch` instead.
- **Default:** without the option, the global `fetch` is used as before, looked up on every call.
