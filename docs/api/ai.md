# @forinda/kickjs-ai

LLM providers, controller routes as model-callable tools, an agent loop, chat memory, and retrieval-augmented generation. The [AI guide](../guide/ai.md) walks through each piece.

## Installation

<PmCommand add="@forinda/kickjs-ai" />

Optional peers: `@anthropic-ai/sdk` for `AnthropicProvider`, `pg` for `PgVectorStore` with a connection string, `zod` (or any schema library `@forinda/kickjs-schema` supports) for route and tool schemas.

## Exports

### Adapter and tokens

| Export                                             | Description                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AiAdapter`                                        | Adapter factory: registers the provider, discovers tools, runs agent loops                                                                                                |
| `AI_ADAPTER`                                       | DI token for the adapter instance (`AiAdapterInstance`)                                                                                                                   |
| `AI_PROVIDER`                                      | DI token for the configured `AiProvider`                                                                                                                                  |
| `VECTOR_STORE`                                     | DI token for a `VectorStore` you register                                                                                                                                 |
| `AI_TOOL_METADATA`                                 | Metadata key `@AiTool` writes                                                                                                                                             |
| `aiAdapterToken(scope)` / `aiProviderToken(scope)` | DI tokens for a scoped adapter — `AiAdapter.scoped('support', { … })` registers under these instead of `AI_ADAPTER` / `AI_PROVIDER`, so several adapters run side by side |

### Tools

| Export          | Description                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `@AiTool(opts)` | Expose a controller method as a tool (`description`, `name`, `inputSchema`). Name defaults to `<Controller>_<method>` |
| `getAiToolMeta` | Read `@AiTool` options for a method                                                                                   |
| `isAiTool`      | Whether a method carries `@AiTool`                                                                                    |

### Providers

| Export              | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `OpenAIProvider`    | OpenAI Chat Completions and embeddings, and OpenAI-compatible endpoints    |
| `AnthropicProvider` | Claude through `@anthropic-ai/sdk`; no embeddings                          |
| `ProviderError`     | Error with the HTTP `status` and response `body` of a failed provider call |
| `ScriptedProvider`  | Test provider that answers with scripted turns and records each input      |

`OpenAIProviderOptions`: `apiKey`, `baseURL`, `defaultChatModel`, `defaultEmbedModel`, `organization`, `name`, `retry`, `fetch`. `AnthropicProviderOptions`: `apiKey`, `baseURL`, `client`, `defaultChatModel`, `defaultMaxTokens`, `effort`, `thinkingDisplay`. `RetryOptions`: `maxRetries` (default 3, `0` disables), `baseDelayMs` (default 1000, doubles each attempt), `maxDelayMs`.

### Structured output and attachments

| Export                                  | Description                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `chatObject(provider, input, options?)` | `chat()` with a `schema`, returning only the validated answer, typed from the schema                                                      |
| `StructuredOutputError`                 | Thrown when the answer doesn't match the schema after retries (or the model refused); carries `issues` and `raw`                          |
| `attachmentFromFile(file, options?)`    | A `ContentPart` from an upload (`ctx.file`). Images, PDFs and text go as-is; other formats throw unless `options.normalize` converts them |

```ts
const Advice = z.object({ summary: z.string(), steps: z.array(z.string()) })
const advice = await chatObject(ai.getProvider(), {
  messages: [{ role: 'user', content: 'How do I rotate my API keys?' }],
  schema: Advice,
})
```

`chat()` itself accepts `schema`, `schemaName` and `schemaRetries` on `ChatInput` and returns the parsed answer as `ChatResponse.object`; `stream()` does not take a schema.

### Settings (`@forinda/kickjs-ai/settings`)

A separate entry; needs a `@forinda/kickjs` with `defineSettings`, and no schema library. See [Provider config from the environment](../guide/ai.md#provider-config-from-the-environment).

| Export                                      | Description                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `OpenAISettings`                            | Section `OPENAI`: `apiKey` (required), `baseURL`, `defaultChatModel`, `defaultEmbedModel`, `organization` |
| `AnthropicSettings`                         | Section `ANTHROPIC`: `apiKey`, `baseURL`, `defaultChatModel`, `defaultMaxTokens`                          |
| `openAIFromSettings(section?, options?)`    | An `OpenAIProvider` built from the section on first use; `AiAdapter` declares the section                 |
| `anthropicFromSettings(section?, options?)` | The same for `AnthropicProvider`                                                                          |

### Prompts and memory

| Export                    | Description                                                      |
| ------------------------- | ---------------------------------------------------------------- |
| `createPrompt` / `Prompt` | `{{variable}}` templates (dotted paths resolve nested values)    |
| `InMemoryChatMemory`      | Process-local conversation history                               |
| `SlidingWindowChatMemory` | Wraps a memory with a message cap; pins the first system message |

### RAG

| Export                                                         | Description                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `RagService`                                                   | `new RagService(provider, store)`: `index`, `search`, `augmentChatInput` |
| `InMemoryVectorStore`                                          | Brute-force cosine search in memory                                      |
| `PgVectorStore`                                                | Postgres + pgvector                                                      |
| `QdrantVectorStore`                                            | Qdrant over REST                                                         |
| `PineconeVectorStore`                                          | Pinecone over REST                                                       |
| `buildWhereClause`, `buildQdrantFilter`, `buildPineconeFilter` | Filter translators, exported for testing                                 |
| `cosineSimilarity`, `toPgVector`                               | Vector helpers                                                           |

## AiAdapter options

```ts
interface AiAdapterOptions {
  provider: AiProvider
  /** Applied to every runAgent call; per-call values win. */
  defaults?: ChatOptions & { model?: string }
  /** Routes carrying these route flags become tools without @AiTool. */
  exposeWhen?: RouteFlagTest
  /** Routes carrying these route flags are never tools. */
  hideWhen?: RouteFlagTest
}
```

## AiAdapterInstance

Inject with `@Inject(AI_ADAPTER)`.

| Method                        | Description                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `runAgent(options)`           | Chat → tool calls → dispatch → feedback until the model answers or `maxSteps` (default 8)   |
| `runAgentWithMemory(options)` | One agent turn with history loaded from and saved to a `ChatMemory`                         |
| `getProvider(name?)`          | A registered provider, or the default when `name` is omitted                                |
| `registerProvider(name, p)`   | Mount another provider under `name` (replaces an existing one with that name)               |
| `unregisterProvider(name)`    | Unmount a provider; the default can't be removed                                            |
| `getTools()`                  | Discovered tool definitions                                                                 |
| `setServerBaseUrl(url)`       | Send tool calls to a URL over HTTP instead of through the app (tests driving hooks by hand) |

`RunAgentOptions` adds `messages`, `provider` (a registered name or an instance), `model`, `tools` (`'auto'` or a list), `maxSteps`, `headers` (sent with every tool call) and `signal` to `ChatOptions`. `RunAgentResult` has `content`, `messages`, `steps`, `usage` (summed across steps, cache tokens included), `maxStepsReached`, `finishReason` and `refusal`.

## Chat types

| Type           | Key fields                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatMessage`  | `role`, `content`, `attachments`, `toolCalls`, `toolCallId`, `isError`, `providerContent`                                                    |
| `ChatOptions`  | `temperature`, `topP`, `maxTokens`, `stopSequences`, `effort`, `signal`                                                                      |
| `ChatResponse` | `content`, `object`, `toolCalls`, `usage`, `finishReason` (`stop` / `length` / `tool_call` / `content_filter`), `refusal`, `providerContent` |
| `ChatChunk`    | `content`, `toolCallDelta` (`id`, `index`, `name`, `argumentsDelta`), `done`; final chunk `finishReason`, `usage`                            |
| `ChatUsage`    | `promptTokens`, `completionTokens`, `totalTokens`, `cacheReadTokens`, `cacheWriteTokens`                                                     |
| `ContentPart`  | `{ type: 'text', text }`, `{ type: 'image', data, mimeType }` or `{ type: 'file', data, mimeType, filename? }`                               |
| `AiProvider`   | `name`, `chat`, `stream`, `embed`, optional `tool` — implement it for a custom provider                                                      |

## Related

- [AI guide](../guide/ai.md) — including [custom providers](../guide/ai.md#custom-providers)
- [MCP](./mcp.md) — expose routes to Model Context Protocol clients
- [Route flags](../guide/route-flags.md)
