# @forinda/kickjs-ai

LLM providers, controller routes as model-callable tools, an agent loop, chat memory, and retrieval-augmented generation. The [AI guide](../guide/ai.md) walks through each piece.

## Installation

<PmCommand add="@forinda/kickjs-ai" />

Optional peers: `@anthropic-ai/sdk` for `AnthropicProvider`, `pg` for `PgVectorStore` with a connection string, `zod` (or any schema library `@forinda/kickjs-schema` supports) for route and tool schemas.

## Exports

### Adapter and tokens

| Export             | Description                                                                |
| ------------------ | -------------------------------------------------------------------------- |
| `AiAdapter`        | Adapter factory: registers the provider, discovers tools, runs agent loops |
| `AI_ADAPTER`       | DI token for the adapter instance (`AiAdapterInstance`)                    |
| `AI_PROVIDER`      | DI token for the configured `AiProvider`                                   |
| `VECTOR_STORE`     | DI token for a `VectorStore` you register                                  |
| `AI_TOOL_METADATA` | Metadata key `@AiTool` writes                                              |

### Tools

| Export          | Description                                                                 |
| --------------- | --------------------------------------------------------------------------- |
| `@AiTool(opts)` | Expose a controller method as a tool (`description`, `name`, `inputSchema`) |
| `getAiToolMeta` | Read `@AiTool` options for a method                                         |
| `isAiTool`      | Whether a method carries `@AiTool`                                          |

### Providers

| Export              | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `OpenAIProvider`    | OpenAI Chat Completions and embeddings, and OpenAI-compatible endpoints    |
| `AnthropicProvider` | Claude through `@anthropic-ai/sdk`; no embeddings                          |
| `ProviderError`     | Error with the HTTP `status` and response `body` of a failed provider call |

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
| `getProvider()`               | The configured `AiProvider`                                                                 |
| `getTools()`                  | Discovered tool definitions                                                                 |
| `setServerBaseUrl(url)`       | Send tool calls to a URL over HTTP instead of through the app (tests driving hooks by hand) |

`RunAgentOptions` adds `messages`, `model`, `tools` (`'auto'` or a list), `maxSteps`, `headers` (sent with every tool call) and `signal` to `ChatOptions`. `RunAgentResult` has `content`, `messages`, `steps`, `usage`, `maxStepsReached`, `finishReason` and `refusal`.

## Chat types

| Type           | Key fields                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ChatMessage`  | `role`, `content`, `toolCalls`, `toolCallId`, `isError`, `providerContent`                                                         |
| `ChatOptions`  | `temperature`, `topP`, `maxTokens`, `stopSequences`, `effort`, `signal`                                                            |
| `ChatResponse` | `content`, `toolCalls`, `usage`, `finishReason` (`stop` / `length` / `tool_call` / `content_filter`), `refusal`, `providerContent` |
| `ChatChunk`    | `content`, `toolCallDelta` (`id`, `index`, `name`, `argumentsDelta`), `done`; final chunk `finishReason`, `usage`                  |
| `ChatUsage`    | `promptTokens`, `completionTokens`, `totalTokens`, `cacheReadTokens`, `cacheWriteTokens`                                           |
| `AiProvider`   | `name`, `chat`, `stream`, `embed` — implement it for a custom provider                                                             |

## Related

- [AI guide](../guide/ai.md)
- [MCP](./mcp.md) — expose routes to Model Context Protocol clients
- [Route flags](../guide/route-flags.md)
