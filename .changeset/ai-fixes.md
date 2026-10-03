---
'@forinda/kickjs-ai': minor
---

Fixes and test helpers:

- **`runAgentWithMemory`** takes every `runAgent` option (`effort` was dropped). It also saves nothing until the run succeeds, so a failed turn no longer leaves an unanswered user message in memory.
- **`SlidingWindowChatMemory`** runs writes one at a time, so concurrent adds no longer erase each other.
- **`RunAgentResult.usage`** now sums `cacheReadTokens` and `cacheWriteTokens` across steps.
- **`RagService.index(docs, { batchSize })`** embeds in batches (default 100).
- **Retries:** a `Retry-After` longer than `maxDelayMs` is no longer waited out, and the `ProviderError` is thrown instead. A stream aborted while waiting to retry throws the abort reason.
- **`OpenAIProvider`:** takes a `retry` option. `embed(input, { signal })` can be cancelled (`EmbedOptions`).
- **`AnthropicProvider`:** default model is now `claude-opus-5-5`.
- **New export `ScriptedProvider`:** a test provider that answers with scripted turns and records each input and its options.
- **Exported types:** `RetryOptions` and `EmbedOptions`.
