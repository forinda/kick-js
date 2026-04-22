# @forinda/kickjs-ai

AI runtime for KickJS. Ships provider bindings, an `@AiTool` decorator that turns controller endpoints into model-callable functions, a memory layer for multi-turn chat, RAG primitives with four backends, and an agent loop that drives chat → tool → dispatch → feedback cycles through the normal Express pipeline.

## Features

- **Providers** — built-in `OpenAIProvider` and `AnthropicProvider`, plus any OpenAI-compatible endpoint (Ollama, OpenRouter, vLLM, LocalAI, Azure OpenAI) via a `baseURL` override. Every provider implements `chat()`, `stream()`, and `embed()` against a single normalized interface.
- **`@AiTool` + agent loop** — decorate any controller method and `AiAdapter.runAgent` routes tool calls through internal HTTP dispatch so middleware, auth, validation, and logging still apply.
- **Chat memory** — `ChatMemory` interface with `InMemoryChatMemory` and a `SlidingWindowChatMemory` wrapper that caps history and pins the system prompt. `runAgentWithMemory` handles the turn-to-turn persistence for you.
- **Prompts** — `createPrompt<TVars>` runtime template engine with `{{variable}}` substitution, typed placeholders, and configurable missing-variable handling.
- **RAG** — four `VectorStore` implementations behind the same interface:
  - `InMemoryVectorStore` — zero deps, cosine similarity, good for tests and prototypes
  - `PgVectorStore` — pgvector-backed, duck-typed `SqlExecutor` so it works with `pg.Pool`, Drizzle's `$client`, or any `query()`-shaped shim
  - `QdrantVectorStore` — REST client with lazy collection bootstrap and equality-map filter translation
  - `PineconeVectorStore` — REST client with namespace support and MongoDB-style filter DSL passthrough
- **`RagService`** — ties a provider's embeddings to any `VectorStore` and adds `index`, `search`, and `augmentChatInput` helpers.
- **Retry with backoff** — `postJson` and `postJsonStream` automatically retry transient failures (429, 500, 502, 503, 504) with exponential backoff, jitter, and `Retry-After` header support. Configurable via `RetryOptions`.

## Install

```bash
pnpm add @forinda/kickjs-ai
```

Zod is a peer dependency. No other runtime is required — the built-in providers talk to upstream APIs over `fetch`.

## Quick start

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import { AiAdapter, OpenAIProvider } from '@forinda/kickjs-ai'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    AiAdapter({
      provider: new OpenAIProvider({
        apiKey: getEnv('OPENAI_API_KEY'),
        defaultChatModel: 'gpt-4o-mini',
      }),
    }),
  ],
})
```

Inject the adapter anywhere:

```ts
import { Service, Autowired } from '@forinda/kickjs'
import { AiAdapter } from '@forinda/kickjs-ai'

@Service()
export class SummarizeService {
  @Autowired() private readonly ai!: AiAdapter

  async summarize(text: string): Promise<string> {
    const res = await this.ai.getProvider().chat({
      messages: [
        { role: 'system', content: 'Summarize in two sentences.' },
        { role: 'user', content: text },
      ],
    })
    return res.content
  }
}
```

## Anthropic

```ts
import { AnthropicProvider } from '@forinda/kickjs-ai'

new AnthropicProvider({
  apiKey: getEnv('ANTHROPIC_API_KEY'),
  defaultChatModel: 'claude-opus-4-6',
})
```

Anthropic does not ship an embeddings API — `embed()` throws a descriptive error. For RAG workflows pair it with `OpenAIProvider` for embeddings.

## `@AiTool` — endpoints as tool calls

Because Zod schemas already power route validation, they also power tool definitions — no duplicated type declarations:

```ts
import { Controller, Post, type Ctx } from '@forinda/kickjs'
import { AiTool } from '@forinda/kickjs-ai'
import { createTaskSchema } from './dtos/create-task.dto'

@Controller('/tasks')
export class TaskController {
  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @AiTool({
    name: 'create_task',
    description: 'Create a new task with title and priority',
    inputSchema: createTaskSchema,
  })
  create(ctx: Ctx<KickRoutes.TaskController['create']>) {
    return this.createTaskUseCase.execute(ctx.body)
  }
}
```

Run an agent loop:

```ts
const result = await this.ai.runAgent({
  messages: [
    { role: 'system', content: 'You create tasks for the team.' },
    { role: 'user', content: 'Add a high-priority task to ship the release' },
  ],
  tools: 'auto', // every @AiTool in the registry
  maxSteps: 5,
})

console.log(result.content) // final assistant text
console.log(result.toolCalls) // audit trail of calls
```

Tool dispatch happens through internal HTTP requests against the running KickJS server, so middleware, auth guards, validation, and logging run exactly the same way they do for external callers.

## Chat memory

```ts
import { InMemoryChatMemory, SlidingWindowChatMemory } from '@forinda/kickjs-ai'

const memory = new SlidingWindowChatMemory({
  inner: new InMemoryChatMemory(),
  maxMessages: 20,
  pinSystemPrompt: true,
})

const result = await this.ai.runAgentWithMemory({
  memory,
  userMessage: 'What did I just ask you?',
  systemPrompt: 'You are a helpful assistant.',
  tools: 'auto',
})
```

`runAgentWithMemory` pins the system prompt on the first turn, persists user and assistant messages automatically, and drops large tool results from memory by default (override with `persistToolResults: true` for full-transcript replay).

## RAG

Every backend implements the same `VectorStore<M>` interface, so services that consume the `VECTOR_STORE` DI token never need to know which store is wired in:

```ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import {
  AiAdapter,
  OpenAIProvider,
  QdrantVectorStore,
  VECTOR_STORE,
} from '@forinda/kickjs-ai'

const store = new QdrantVectorStore({
  url: getEnv('QDRANT_URL'),
  apiKey: getEnv('QDRANT_API_KEY'),
  collection: 'docs',
  dimensions: 1536,
})

export const app = await bootstrap({
  modules,
  adapters: [
    AiAdapter({
      provider: new OpenAIProvider({ apiKey: getEnv('OPENAI_API_KEY') }),
    }),
  ],
  plugins: [
    {
      name: 'vector-store',
      register(container) {
        container.registerInstance(VECTOR_STORE, store)
      },
    },
  ],
})
```

Index and query with `RagService`:

```ts
import { Service, Autowired, Inject } from '@forinda/kickjs'
import { AiAdapter, RagService, VECTOR_STORE, type VectorStore } from '@forinda/kickjs-ai'

@Service()
export class KnowledgeService {
  private readonly rag: RagService

  constructor(
    @Autowired() ai: AiAdapter,
    @Inject(VECTOR_STORE) store: VectorStore,
  ) {
    this.rag = new RagService({ provider: ai.getProvider(), store })
  }

  async ask(question: string) {
    const input = await this.rag.augmentChatInput(
      { messages: [{ role: 'user', content: question }] },
      question,
      { topK: 4 },
    )
    const res = await this.rag.getProvider().chat(input)
    return res.content
  }
}
```

## Documentation

Full usage guide: [kickjs.dev/guide/ai](https://forinda.github.io/kick-js/guide/ai)

Related: [`@forinda/kickjs-mcp`](../mcp) exposes the same `@AiTool` methods to external Model Context Protocol clients (Claude Code, Cursor, Zed).

## License

MIT
