---
'@forinda/kickjs-ai': minor
---

Providers follow the current Claude and OpenAI APIs.

**`AnthropicProvider` is built on the official `@anthropic-ai/sdk`** — install it alongside `@forinda/kickjs-ai` (optional peer, loaded on first use).

- Default model `claude-opus-5` (was `claude-opus-4-6`), default `max_tokens` 64000; every request streams, so large values don't time out.
- **Thinking blocks are kept.** They come back on the new `ChatResponse.providerContent` and `runAgent` sends them back with the tool calls they led to; they were dropped before, which multi-step tool loops on thinking models need.
- New options: `effort`, `thinkingDisplay`, `cache` (automatic prompt caching, on by default), `fallbacks` (`'default'` on Claude Opus 5 and Fable/Mythos 5 models: a declined request is re-run on Anthropic's recommended fallback model), `client` (a pre-configured SDK client). `apiKey` is optional; the SDK's credential resolution applies. `apiVersion` is removed.
- `temperature` / `topP` are no longer sent to models that reject them (Opus 4.7+, Sonnet 5, Fable), with a warning; older models get one of the two.
- Consecutive tool results go back in one user message, failed calls with `is_error`. All system messages are joined instead of keeping only the first.
- Stop reasons are normalized (`stop`, `length`, `tool_call`, `content_filter`) and a refusal's category and explanation are on `ChatResponse.refusal`. Usage includes `cacheReadTokens` / `cacheWriteTokens`.
- An error event mid-stream now throws; it used to end the stream as if it had finished. API errors are `ProviderError` with the HTTP status.

**`OpenAIProvider`:** sends `max_completion_tokens` (`max_tokens` is deprecated and rejected by reasoning models); streams every parallel tool-call delta with its `index` and id (only the first was surfaced, and later deltas lost the id); requests usage on the final stream chunk; normalizes `tool_calls` to `tool_call`.

**`runAgent`:** stops without running tool calls when a turn ends with `content_filter` or `length`, and returns `finishReason` / `refusal`. Failed tool calls are marked `isError`. `ChatOptions.effort`, `ChatChunk.finishReason` / `usage`, and `toolCallDelta.index` are new.
